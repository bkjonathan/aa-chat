import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MemberRole } from '@prisma/client';
import { UpdateMemberDto } from './dto/update-member.dto';

// Role hierarchy: owner > admin > member
const ROLE_WEIGHT: Record<MemberRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

@Injectable()
export class RoomMembersService {
  constructor(private prisma: PrismaService) {}

  // ─── Find membership ─────────────────────────────────

  findMembership(roomId: string, userId: string) {
    return this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
  }

  async requireMembership(roomId: string, userId: string) {
    const member = await this.findMembership(roomId, userId);
    if (!member || member.leftAt) {
      throw new ForbiddenException('You are not a member of this room');
    }
    return member;
  }

  async requireRole(roomId: string, userId: string, minimumRole: MemberRole) {
    const member = await this.requireMembership(roomId, userId);
    if (ROLE_WEIGHT[member.role] < ROLE_WEIGHT[minimumRole]) {
      throw new ForbiddenException(
        `This action requires ${minimumRole} role or higher`,
      );
    }
    return member;
  }

  // ─── Get members list ────────────────────────────────

  getMembers(roomId: string) {
    return this.prisma.roomMember.findMany({
      where: { roomId, leftAt: null },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            status: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  }

  // ─── Add members ─────────────────────────────────────

  async addMembers(
    roomId: string,
    userIds: string[],
    role: MemberRole = MemberRole.member,
  ) {
    // Deduplicate
    const unique = [...new Set(userIds)];

    // Find existing memberships (including left)
    const existing = await this.prisma.roomMember.findMany({
      where: { roomId, userId: { in: unique } },
    });

    const existingIds = existing.map((m) => m.userId);
    const toCreate = unique.filter((id) => !existingIds.includes(id));
    const toRejoin = existing.filter((m) => m.leftAt !== null);

    // Create new members
    if (toCreate.length > 0) {
      await this.prisma.roomMember.createMany({
        data: toCreate.map((userId) => ({ roomId, userId, role })),
        skipDuplicates: true,
      });
    }

    // Re-activate members who had left
    if (toRejoin.length > 0) {
      await Promise.all(
        toRejoin.map((m) =>
          this.prisma.roomMember.update({
            where: { id: m.id },
            data: { leftAt: null, role },
          }),
        ),
      );
    }
  }

  // ─── Update member ───────────────────────────────────

  async updateMember(
    roomId: string,
    actorId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ) {
    const actor = await this.requireMembership(roomId, actorId);
    const target = await this.findMembership(roomId, targetUserId);

    if (!target || target.leftAt) {
      throw new NotFoundException('Member not found in this room');
    }

    // Cannot change owner role
    if (target.role === MemberRole.owner) {
      throw new ForbiddenException('Cannot modify the room owner');
    }

    // Admin can only modify members; only owner can manage admins
    if (dto.role && ROLE_WEIGHT[actor.role] <= ROLE_WEIGHT[target.role]) {
      throw new ForbiddenException(
        'You cannot modify a member with equal or higher role',
      );
    }

    return this.prisma.roomMember.update({
      where: { id: target.id },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isMuted !== undefined && { isMuted: dto.isMuted }),
        ...(dto.mutedUntil !== undefined && {
          mutedUntil: new Date(dto.mutedUntil),
        }),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  // ─── Remove member (kick) ────────────────────────────

  async removeMember(roomId: string, actorId: string, targetUserId: string) {
    const actor = await this.requireRole(roomId, actorId, MemberRole.admin);
    const target = await this.findMembership(roomId, targetUserId);

    if (!target || target.leftAt) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === MemberRole.owner) {
      throw new ForbiddenException('Cannot remove the room owner');
    }
    if (ROLE_WEIGHT[actor.role] <= ROLE_WEIGHT[target.role]) {
      throw new ForbiddenException(
        'Cannot remove a member with equal or higher role',
      );
    }

    await this.prisma.roomMember.update({
      where: { id: target.id },
      data: { leftAt: new Date() },
    });
  }

  // ─── Leave room ──────────────────────────────────────

  async leaveRoom(roomId: string, userId: string) {
    const member = await this.requireMembership(roomId, userId);

    if (member.role === MemberRole.owner) {
      // Check if other members exist
      const otherMembers = await this.prisma.roomMember.count({
        where: { roomId, userId: { not: userId }, leftAt: null },
      });

      if (otherMembers > 0) {
        throw new ForbiddenException(
          'Transfer ownership before leaving the room',
        );
      }
    }

    await this.prisma.roomMember.update({
      where: { id: member.id },
      data: { leftAt: new Date() },
    });
  }

  // ─── Transfer ownership ──────────────────────────────

  async transferOwnership(
    roomId: string,
    currentOwnerId: string,
    newOwnerId: string,
  ) {
    await this.requireRole(roomId, currentOwnerId, MemberRole.owner);
    const newOwner = await this.findMembership(roomId, newOwnerId);

    if (!newOwner || newOwner.leftAt) {
      throw new NotFoundException('New owner must be a current member');
    }

    await this.prisma.$transaction([
      this.prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId: currentOwnerId } },
        data: { role: MemberRole.admin },
      }),
      this.prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId: newOwnerId } },
        data: { role: MemberRole.owner },
      }),
    ]);
  }

  // ─── Mark as read ────────────────────────────────────

  async markAsRead(roomId: string, userId: string) {
    await this.requireMembership(roomId, userId);
    return this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { lastReadAt: new Date(), unreadCount: 0 },
    });
  }

  // ─── Increment unread for all members except sender ──

  async incrementUnread(roomId: string, excludeUserId: string) {
    await this.prisma.roomMember.updateMany({
      where: { roomId, userId: { not: excludeUserId }, leftAt: null },
      data: { unreadCount: { increment: 1 } },
    });
  }

  // Add to RoomMembersService class
  async getUserRoomIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.roomMember.findMany({
      where: { userId, leftAt: null },
      select: { roomId: true },
    });
    return memberships.map((m) => m.roomId);
  }

  async getRoomMemberIds(roomId: string): Promise<string[]> {
    const members = await this.prisma.roomMember.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
}
