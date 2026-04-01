import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('$2b$12$mockedhashvalue'),
}));

// ─── Mocks ───────────────────────────────────────────

const mockUser = {
  id: 'user-uuid-1',
  username: 'testuser',
  email: 'test@example.com',
  passwordHash: '$2b$12$hashedpassword',
  displayName: 'Test User',
  avatarUrl: null,
  bio: null,
  status: 'offline',
  lastSeenAt: null,
  isVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  refreshToken: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
};

const mockUsersService = {
  findByEmail: jest.fn(),
  findByUsername: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  sanitize: jest.fn(({ passwordHash: _p, ...safe }: typeof mockUser) => safe),
  updateLastSeen: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn(),
};

const configMap: Record<string, string> = {
  'jwt.accessSecret': 'test-access-secret',
  'jwt.accessExpiration': '15m',
  'jwt.refreshSecret': 'test-refresh-secret',
  'jwt.refreshExpiration': '7d',
};

const mockConfigService = {
  get: jest.fn((key: string) => configMap[key]),
  getOrThrow: jest.fn((key: string) => configMap[key]),
};

// ─── Test Suite ──────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ─── validateUser ──────────────────────────────────

  describe('validateUser', () => {
    it('returns user when credentials are valid', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'password');
      expect(result).toEqual(mockUser);
    });

    it('returns null when user not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('unknown@example.com', 'pass');
      expect(result).toBeNull();
    });

    it('returns null when password does not match', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser(
        'test@example.com',
        'wrongpass',
      );
      expect(result).toBeNull();
    });
  });

  // ─── register ─────────────────────────────────────

  describe('register', () => {
    const registerDto = {
      username: 'newuser',
      email: 'new@example.com',
      password: 'StrongPass123!',
      displayName: 'New User',
    };

    it('creates user and returns token pair', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockUsersService.findByUsername.mockResolvedValue(null);
      mockUsersService.create.mockResolvedValue(mockUser);
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({});

      const result = await service.register(registerDto);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(mockUsersService.create).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when email already exists', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockUsersService.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when username already taken', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockUsersService.findByUsername.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('hashes password before storing', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockUsersService.findByUsername.mockResolvedValue(null);
      mockUsersService.create.mockResolvedValue(mockUser);
      mockJwtService.signAsync.mockResolvedValue('token');
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({});

      await service.register(registerDto);

      const createCall = mockUsersService.create.mock.calls[0][0];
      expect(createCall.passwordHash).not.toBe(registerDto.password);
      expect(createCall.passwordHash).toMatch(/^\$2b\$/);
    });
  });

  // ─── login ────────────────────────────────────────

  describe('login', () => {
    it('returns token pair and sanitized user', async () => {
      mockJwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({});
      mockUsersService.updateLastSeen.mockResolvedValue(undefined);

      const result = await service.login(mockUser as any);

      expect(result.accessToken).toBe('access-token');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(mockUsersService.updateLastSeen).toHaveBeenCalledWith(mockUser.id);
    });
  });

  // ─── logout ───────────────────────────────────────

  describe('logout', () => {
    it('revokes all sessions when no refreshToken provided', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.logout(mockUser.id);

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  // ─── refreshTokens ────────────────────────────────

  describe('refreshTokens', () => {
    it('throws when no valid stored token found', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(
        service.refreshTokens({
          sub: mockUser.id,
          email: mockUser.email,
          username: mockUser.username,
          tokenId: 'some-id',
          refreshToken: 'raw-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('revokes all tokens on hash mismatch (reuse attack)', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'token-id',
        tokenHash: '$2b$12$differenthash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.refreshTokens({
          sub: mockUser.id,
          email: mockUser.email,
          username: mockUser.username,
          tokenId: 'some-id',
          refreshToken: 'stolen-token',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
