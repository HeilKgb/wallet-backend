import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Garante que o usuário autenticado só acesse/altere o próprio recurso (:id da rota). */
@Injectable()
export class OwnResourceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const resourceId = request.params.id;

    if (!request.user || request.user.sub !== resourceId) {
      throw new ForbiddenException('acesso permitido apenas ao próprio usuário');
    }

    return true;
  }
}
