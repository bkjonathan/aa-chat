import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { AuthenticatedSocket } from './ws-jwt.middleware';

@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client: AuthenticatedSocket = context
      .switchToWs()
      .getClient<AuthenticatedSocket>();

    if (!client.userId) {
      throw new WsException('Unauthorized');
    }

    return true;
  }
}
