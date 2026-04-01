import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RoomMembersService } from './room-members.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { QueryRoomsDto } from './dto/query-rooms.dto';
import { MemberRole, RoomType, Prisma } from '@prisma/client';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  10,
);

@Injectable()
export class RoomsService {
  constructor(
    private prisma: PrismaService,
    private membersService: RoomMembersService,
  ) {}

  // ─── Select shape for room list ──────────────────────

  private roomSelect = {
    id: true,
    type: true,
    name: true,
    slug: true,
    description: true,
    iconUrl: true,
    isPrivate: true,
    isArchived: true,
    lastMessageAt: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    _count: { select: { members: { where: { leftAt: null } } } },
  } satisfies Prisma.RoomSelect;

  // ─── Get user's rooms ────────────────────────────────

  async getUserRooms(userId: string, dto: QueryRoomsDto) {
    const where: Prisma.RoomWhereInput = {
      members: {
        some: { userId, leftAt: null },
      },
      isArchived: false,
      ...(dto.type && { type: dto.type }),
      ...(dto.search && {
        name: { contains: dto.search, mode: 'insensitive' },
      }),
    };

    const rooms = await this.prisma.room.findMany({
      where,
      select: {
        ...this.roomSelect,
        members: {
          where: { userId },
          select: {
            role: true,
            unreadCount: true,
            lastReadAt: true,
            isMuted: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            content: true,
            type: true,
            createdAt: true,
            sender: {
              select: { id: true, username: true, displayName: true },
            },
          },
        },
      },
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });

    // For DMs: enrich with the other member's profile
    const enriched = await Promise.all(
      rooms.map(async (room) => {
        if (room.type !== RoomType.dm) return room;

        const otherMember = await this.prisma.roomMember.findFirst({
          where: { roomId: room.id, userId: { not: userId }, leftAt: null },
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
        });

        return { ...room, dmPartner: otherMember?.user ?? null };
      }),
    );

    return enriched;
  }

  // ─── Get single room ─────────────────────────────────

  async findById(roomId: string, requestingUserId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: this.roomSelect,
    });

    if (!room) throw new NotFoundException('Room not found');

    // Check access for private rooms
    if (room.isPrivate) {
      const membership = await this.membersService.findMembership(
        roomId,
        requestingUserId,
      );
      if (!membership || membership.leftAt) {
        throw new ForbiddenException('This room is private');
      }
    }

    return room;
  }

  // ─── Create room ─────────────────────────────────────

  async create(creatorId: string, dto: CreateRoomDto) {
    // DM deduplication
    if (dto.type === RoomType.dm) {
      return this.findOrCreateDm(creatorId, dto);
    }

    // Group/channel require a name
    if (!dto.name?.trim()) {
      throw new BadRequestException(
        'Name is required for group and channel rooms',
      );
    }

    // Auto-generate slug if not provided
    const slug = dto.slug?.trim()
      ? await this.ensureUniqueSlug(dto.slug.trim())
      : null;

    const room = await this.prisma.room.create({
      data: {
        type: dto.type,
        name: dto.name.trim(),
        slug,
        description: dto.description,
        isPrivate: dto.isPrivate ?? false,
        createdBy: creatorId,
        members: {
          create: {
            userId: creatorId,
            role: MemberRole.owner,
          },
        },
      },
      select: this.roomSelect,
    });

    // Add initial members
    if (dto.memberIds && dto.memberIds.length > 0) {
      await this.membersService.addMembers(room.id, dto.memberIds);
    }

    return room;
  }

  // ─── DM deduplication ────────────────────────────────

  private async findOrCreateDm(creatorId: string, dto: CreateRoomDto) {
    const partnerIds = dto.memberIds ?? [];

    if (partnerIds.length !== 1) {
      throw new BadRequestException('DM requires exactly one recipient');
    }

    const partnerId = partnerIds[0];

    if (partnerId === creatorId) {
      throw new BadRequestException('Cannot create a DM with yourself');
    }

    // Check if DM already exists between these two users
    const existing = await this.prisma.room.findFirst({
      where: {
        type: RoomType.dm,
        AND: [
          { members: { some: { userId: creatorId, leftAt: null } } },
          { members: { some: { userId: partnerId, leftAt: null } } },
        ],
      },
      select: this.roomSelect,
    });

    if (existing) return existing;

    // Create new DM
    return this.prisma.room.create({
      data: {
        type: RoomType.dm,
        createdBy: creatorId,
        isPrivate: true,
        members: {
          createMany: {
            data: [
              { userId: creatorId, role: MemberRole.member },
              { userId: partnerId, role: MemberRole.member },
            ],
          },
        },
      },
      select: this.roomSelect,
    });
  }

  // ─── Update room ─────────────────────────────────────

  async update(roomId: string, actorId: string, dto: UpdateRoomDto) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');

    if (room.type === RoomType.dm) {
      throw new ForbiddenException('Cannot edit a DM room');
    }

    await this.membersService.requireRole(roomId, actorId, MemberRole.admin);

    return this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isPrivate !== undefined && { isPrivate: dto.isPrivate }),
      },
      select: this.roomSelect,
    });
  }

  // ─── Archive room ────────────────────────────────────

  async archive(roomId: string, actorId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');

    await this.membersService.requireRole(roomId, actorId, MemberRole.owner);

    return this.prisma.room.update({
      where: { id: roomId },
      data: { isArchived: true },
      select: this.roomSelect,
    });
  }

  async unarchive(roomId: string, actorId: string) {
    await this.membersService.requireRole(roomId, actorId, MemberRole.owner);
    return this.prisma.room.update({
      where: { id: roomId },
      data: { isArchived: false },
      select: this.roomSelect,
    });
  }

  // ─── Invite links ────────────────────────────────────

  async createInvite(roomId: string, userId: string, dto: CreateInviteDto) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.type === RoomType.dm) {
      throw new ForbiddenException('Cannot create invite links for DMs');
    }

    await this.membersService.requireRole(roomId, userId, MemberRole.admin);

    const inviteCode = nanoid();

    return this.prisma.roomInvite.create({
      data: {
        roomId,
        invitedBy: userId,
        inviteCode,
        maxUses: dto.maxUses ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async getInvites(roomId: string, userId: string) {
    await this.membersService.requireRole(roomId, userId, MemberRole.admin);
    return this.prisma.roomInvite.findMany({
      where: { roomId },
      include: {
        inviter: {
          select: { id: true, username: true, displayName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async useInvite(inviteCode: string, userId: string) {
    const invite = await this.prisma.roomInvite.findUnique({
      where: { inviteCode },
      include: { room: { select: { id: true, type: true, isArchived: true } } },
    });

    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.room.isArchived) {
      throw new ForbiddenException('This room is archived');
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new ForbiddenException('This invite has expired');
    }
    if (invite.maxUses && invite.useCount >= invite.maxUses) {
      throw new ForbiddenException('This invite has reached its maximum uses');
    }

    // Check if already a member
    const existing = await this.membersService.findMembership(
      invite.roomId,
      userId,
    );
    if (existing && !existing.leftAt) {
      throw new ConflictException('Already a member of this room');
    }

    // Add member and increment use count in a transaction
    await this.prisma.$transaction([
      this.prisma.roomMember.upsert({
        where: { roomId_userId: { roomId: invite.roomId, userId } },
        update: { leftAt: null, role: MemberRole.member },
        create: { roomId: invite.roomId, userId, role: MemberRole.member },
      }),
      this.prisma.roomInvite.update({
        where: { id: invite.id },
        data: { useCount: { increment: 1 } },
      }),
    ]);

    return this.prisma.room.findUnique({
      where: { id: invite.roomId },
      select: this.roomSelect,
    });
  }

  async deleteInvite(inviteId: string, userId: string) {
    const invite = await this.prisma.roomInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite) throw new NotFoundException('Invite not found');

    await this.membersService.requireRole(
      invite.roomId,
      userId,
      MemberRole.admin,
    );

    await this.prisma.roomInvite.delete({ where: { id: inviteId } });
  }

  // ─── Update last message timestamp ───────────────────
  // Called by MessagesService in Phase 5

  async touchLastMessage(roomId: string) {
    await this.prisma.room.update({
      where: { id: roomId },
      data: { lastMessageAt: new Date() },
    });
  }

  // ─── Helpers ─────────────────────────────────────────

  private async ensureUniqueSlug(slug: string): Promise<string> {
    const existing = await this.prisma.room.findUnique({ where: { slug } });
    if (!existing) return slug;
    return `${slug}-${nanoid().slice(0, 4)}`;
  }
}
