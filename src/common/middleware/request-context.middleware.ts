import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Atribui um requestId a cada requisição (reaproveita x-request-id se o client já
 * mandar um, ex: vindo de um API Gateway/load balancer). Esse id aparece em todos
 * os logs relacionados à requisição e é devolvido no header de resposta, permitindo
 * rastrear uma chamada específica do início ao fim - essencial pra debugar e auditar.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string | undefined) || randomUUID();
    req.id = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
