import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
// import { WsException } from '@nestjs/websockets';
import { UsersService } from '../users/users.service';

export interface AuthenticatedSocket extends Socket {
  userId: string;
  username: string;
  email: string;
}

@Injectable()
export class WsJwtMiddleware {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  // Returns a Socket.io middleware function
  middleware() {
    return async (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      try {
        // Token can come from handshake auth or query string
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
          socket.handshake.query?.token;

        if (!token) {
          return next(new Error('Authentication token missing'));
        }

        const payload = await this.jwtService.verifyAsync(token as string, {
          secret: this.configService.get<string>('jwt.accessSecret'),
        });

        // Verify user still exists
        const user = await this.usersService.findById(payload.sub);
        if (!user) {
          return next(new Error('User not found'));
        }

        // Attach to socket for use in gateway
        socket.userId = payload.sub;
        socket.username = payload.username;
        socket.email = payload.email;

        next();
      } catch (_) {
        next(new Error('Invalid or expired token'));
      }
    };
  }
}
