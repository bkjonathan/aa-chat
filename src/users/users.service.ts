import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import {
  SEARCH_EVENTS,
  UserCreatedEvent,
  UserUpdatedEvent,
} from 'src/search/search.events';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  // ─── Sanitize ────────────────────────────────────────

  sanitize(user: User): SafeUser {
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  // ─── Finders ─────────────────────────────────────────
  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  // ─── Search users ────────────────────────────────────

  async findMany(dto: QueryUsersDto) {
    const { search, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { displayName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
          status: true,
          lastSeenAt: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Create ──────────────────────────────────────────

  async create(data: Prisma.UserCreateInput): Promise<User> {
    try {
      const user = await this.prisma.user.create({
        data: {
          ...data,
          settings: { create: {} },
        },
      });

      this.eventEmitter.emit(
        SEARCH_EVENTS.USER_CREATED,
        new UserCreatedEvent({
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          status: user.status,
          isVerified: user.isVerified,
          createdAt: user.createdAt,
        }),
      );
      return user;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const field = (e.meta?.target as string[])?.join(', ');
        throw new ConflictException(`${field} already in use`);
      }
      throw e;
    }
  }

  // ─── Update profile ──────────────────────────────────

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    await this.findByIdOrThrow(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
    this.eventEmitter.emit(
      SEARCH_EVENTS.USER_UPDATED,
      new UserUpdatedEvent(id, {
        displayName: dto.displayName,
        bio: dto.bio,
        status: dto.status,
      }),
    );
    return this.sanitize(updated);
  }

  // ─── Avatar (placeholder — S3 wired in Phase 6) ──────

  async updateAvatar(id: string, avatarUrl: string): Promise<SafeUser> {
    await this.findByIdOrThrow(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { avatarUrl },
    });
    return this.sanitize(updated);
  }

  // ─── Settings ────────────────────────────────────────

  async getSettings(userId: string) {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (!settings) throw new NotFoundException('Settings not found');
    return settings;
  }

  updateSettings(userId: string, dto: UpdateSettingsDto) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      update: {
        ...(dto.notificationSound !== undefined && {
          notificationSound: dto.notificationSound,
        }),
        ...(dto.desktopNotifications !== undefined && {
          desktopNotifications: dto.desktopNotifications,
        }),
        ...(dto.theme !== undefined && { theme: dto.theme }),
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      },
      create: {
        userId,
        notificationSound: dto.notificationSound ?? true,
        desktopNotifications: dto.desktopNotifications ?? true,
        theme: dto.theme ?? 'system',
        language: dto.language ?? 'en',
        timezone: dto.timezone ?? 'UTC',
      },
    });
  }

  // ─── Block / unblock ─────────────────────────────────

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new ForbiddenException('Cannot block yourself');
    }
    await this.findByIdOrThrow(blockedId);

    try {
      return await this.prisma.userBlock.create({
        data: { blockerId, blockedId },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('User already blocked');
      }
      throw e;
    }
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId, blockedId },
    });
  }

  getBlockedUsers(userId: string) {
    return this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
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

  // ─── Helpers ─────────────────────────────────────────

  async updateLastSeen(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }
}
