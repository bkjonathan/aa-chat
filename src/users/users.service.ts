import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { User, Prisma } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Strip password from returned user
  private exclude<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).filter(
        ([k]) => !keys.includes(k as K),
      ),
    ) as Omit<T, K>;
  }

  sanitize(user: User): SafeUser {
    return this.exclude(user, ['passwordHash']);
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    try {
      const user = await this.prisma.user.create({
        data: {
          ...data,
          settings: {
            create: {}, // auto-create default settings
          },
        },
      });
      return user;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          const field = (e.meta?.target as string[])?.join(', ');
          throw new ConflictException(`${field} already in use`);
        }
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.displayName && { displayName: dto.displayName }),
        ...(dto.bio && { bio: dto.bio }),
        ...(dto.status && { status: dto.status }),
      },
    });
    return this.sanitize(updated);
  }

  async updateLastSeen(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }
}
