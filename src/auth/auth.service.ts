import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { JwtRefreshPayload } from './strategies/jwt-refresh.strategy';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@prisma/client';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: Omit<User, 'passwordHash'>;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 12;

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // ─── Validate user for LocalStrategy ────────────────

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return null;

    return user;
  }

  // ─── Register ────────────────────────────────────────

  async register(
    dto: RegisterDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const [existingEmail, existingUsername] = await Promise.all([
      this.usersService.findByEmail(dto.email),
      this.usersService.findByUsername(dto.username),
    ]);

    if (existingEmail) throw new ConflictException('Email already registered');
    if (existingUsername) throw new ConflictException('Username already taken');

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    const user = await this.usersService.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      displayName: dto.displayName ?? dto.username,
    });

    const tokens = await this.generateTokens(user);
    await this.storeRefreshToken(user.id, tokens.refreshToken, ip, userAgent);

    this.logger.log(`New user registered: ${user.email}`);

    return {
      user: this.usersService.sanitize(user),
      ...tokens,
    };
  }

  // ─── Login ───────────────────────────────────────────

  async login(
    user: User,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const tokens = await this.generateTokens(user);
    await this.storeRefreshToken(user.id, tokens.refreshToken, ip, userAgent);

    // Update last seen
    await this.usersService.updateLastSeen(user.id);

    return {
      user: this.usersService.sanitize(user),
      ...tokens,
    };
  }

  // ─── Refresh token rotation ──────────────────────────

  async refreshTokens(
    payload: JwtRefreshPayload & { refreshToken: string },
    ip?: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const { sub: userId, refreshToken } = payload;

    // Find stored token
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token not found or expired');
    }

    // Validate hash
    const isValid = await bcrypt.compare(refreshToken, storedToken.tokenHash);
    if (!isValid) {
      // Possible token reuse — revoke all tokens for this user
      await this.revokeAllUserTokens(userId);
      throw new UnauthorizedException(
        'Refresh token invalid. All sessions revoked.',
      );
    }

    // Revoke old token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Issue new pair
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const tokens = await this.generateTokens(user);
    await this.storeRefreshToken(userId, tokens.refreshToken, ip, userAgent);

    return tokens;
  }

  // ─── Logout ──────────────────────────────────────────

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      // Revoke only this device's token
      const tokens = await this.prisma.refreshToken.findMany({
        where: { userId, revokedAt: null },
      });

      for (const token of tokens) {
        const isMatch = await bcrypt.compare(refreshToken, token.tokenHash);
        if (isMatch) {
          await this.prisma.refreshToken.update({
            where: { id: token.id },
            data: { revokedAt: new Date() },
          });
          break;
        }
      }
    } else {
      // Revoke all sessions (logout everywhere)
      await this.revokeAllUserTokens(userId);
    }
  }

  // ─── Token helpers ───────────────────────────────────

  private async generateTokens(user: User): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
    };

    const refreshPayload: JwtRefreshPayload = {
      ...payload,
      tokenId: uuidv4(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: this.configService.getOrThrow<string>(
          'jwt.accessExpiration',
        ) as StringValue,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.configService.getOrThrow<string>(
          'jwt.refreshExpiration',
        ) as StringValue,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(
    userId: string,
    rawToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const tokenHash = await bcrypt.hash(rawToken, this.SALT_ROUNDS);

    const expirationDays = parseInt(
      this.configService
        .getOrThrow<string>('jwt.refreshExpiration')
        .replace('d', ''),
      10,
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expirationDays);

    const deviceInfo = userAgent ? { userAgent } : null;

    let existingToken: any = null;
    if (ipAddress || deviceInfo) {
      existingToken = await this.prisma.refreshToken.findFirst({
        where: {
          userId,
          ipAddress: ipAddress || null,
          ...(deviceInfo ? { deviceInfo: { equals: deviceInfo } } : {}),
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
    }

    if (existingToken) {
      // Update existing token session for the same IP/Device
      await this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { tokenHash, expiresAt },
      });
    } else {
      // Create new token session
      await this.prisma.refreshToken.create({
        data: { 
          userId, 
          tokenHash, 
          expiresAt, 
          ipAddress: ipAddress || null, 
          ...(deviceInfo ? { deviceInfo } : {}) 
        },
      });
    }

    // Cleanup: remove old expired tokens for this user
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }],
      },
    });
  }

  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ─── Get current user profile ────────────────────────

  async getProfile(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');
    return this.usersService.sanitize(user);
  }
}
