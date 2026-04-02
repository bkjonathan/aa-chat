import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Ip,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { User } from '@prisma/client';
import type { JwtRefreshPayload } from './strategies/jwt-refresh.strategy';
import { ThrottleAuth } from 'src/common/throttler/throttle.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // ─── Register ────────────────────────────────────────

  @Public()
  @ThrottleAuth()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email or username already in use' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.register(dto, ip, userAgent);
  }

  // ─── Login ───────────────────────────────────────────
  @ThrottleAuth()
  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful, returns token pair',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(
    @CurrentUser() user: User,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.login(user, ip, userAgent);
  }

  // ─── Refresh ─────────────────────────────────────────
  @ThrottleAuth()
  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get new access token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'New token pair issued' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or expired' })
  refresh(
    @CurrentUser() user: JwtRefreshPayload & { refreshToken: string },
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.refreshTokens(user, ip, userAgent);
  }

  // ─── Logout ──────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from current device' })
  @ApiResponse({ status: 204, description: 'Logged out successfully' })
  async logout(@CurrentUser() user: User, @Body() body: RefreshTokenDto) {
    await this.authService.logout(user.id, body.refreshToken);
  }

  // ─── Logout all devices ──────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout from all devices' })
  async logoutAll(@CurrentUser() user: User) {
    await this.authService.logout(user.id);
  }

  // ─── Me ──────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  me(@CurrentUser() user: User) {
    return this.authService.getProfile(user.id);
  }
}
