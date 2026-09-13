import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Loga toda requisição HTTP que chega na API: método, rota, usuário (se autenticado),
 * status de resposta, duração e requestId. Isso sozinho já cobre boa parte da
 * auditoria básica ("quem fez o quê e quando") e é a primeira coisa a olhar ao
 * investigar um problema em produção - mesmo antes de entrar no log de erro específico.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        // Em sucesso, response.statusCode já reflete o valor final (200/201/etc).
        next: () => this.logRequest(request, response.statusCode, startedAt),
        // Em erro, o AllExceptionsFilter só define o status final DEPOIS que esse
        // interceptor roda - response.statusCode aqui ainda teria o valor pré-definido
        // pelo Nest para a rota (ex: 201 para POST), não o 500/4xx real. Por isso
        // calculamos o status a partir da própria exceção.
        error: (error: unknown) => this.logRequest(request, this.resolveErrorStatus(error), startedAt),
      }),
    );
  }

  private resolveErrorStatus(error: unknown): number {
    return error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private logRequest(request: Request, statusCode: number, startedAt: number): void {
    const durationMs = Date.now() - startedAt;
    const userId = request.user?.sub ?? 'anônimo';
    const line = `${request.method} ${request.originalUrl} ${statusCode} +${durationMs}ms user=${userId} reqId=${request.id}`;

    if (statusCode >= 500) {
      this.logger.error(line);
    } else if (statusCode >= 400) {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }
}
