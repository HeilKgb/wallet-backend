import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Rede de segurança para logging de erros: independente de qualquer service ter
 * (ou não) logado a causa raiz antes de lançar uma exceção, ESTE filtro sempre
 * loga o erro original completo (stack trace incluído) antes de responder ao
 * client. Isso existe porque descobrimos um bug real onde o service convertia
 * qualquer erro inesperado em `new InternalServerErrorException(mensagem genérica)`,
 * descartando a causa raiz (ex: erro de SQL, coluna inexistente, etc.) - o erro
 * de fato acontecia, mas a informação sobre O QUE aconteceu se perdia para sempre
 * no meio do caminho, antes de chegar em qualquer lugar que pudesse logá-la.
 *
 * O client nunca recebe o stack trace nem detalhes internos - só uma mensagem
 * segura e o requestId, que serve pra localizar o log completo depois.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const clientPayload = exception instanceof HttpException ? exception.getResponse() : 'erro interno do servidor';

    const requestId = request.id;
    const userId = request.user?.sub ?? 'anônimo';
    const context = `${request.method} ${request.originalUrl} user=${userId} reqId=${requestId}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // 5xx = bug ou falha de infraestrutura: precisa do stack trace completo pra investigar.
      const stack = exception instanceof Error ? exception.stack : undefined;
      const cause = this.describeCause(exception);
      this.logger.error(`${context} -> 500 | causa: ${cause}`, stack);
    } else if (status >= HttpStatus.BAD_REQUEST) {
      // 4xx = erro esperado do cliente (validação, regra de negócio) - vale logar em nível
      // mais baixo pra não poluir, mas ainda é útil pra auditoria (ex: tentativas repetidas).
      this.logger.warn(`${context} -> ${status} | ${JSON.stringify(clientPayload)}`);
    }

    response.status(status).json(
      typeof clientPayload === 'string'
        ? { statusCode: status, message: clientPayload, requestId }
        : { ...(clientPayload as Record<string, unknown>), requestId },
    );
  }

  /** Extrai uma descrição útil do erro cru, incluindo detalhes específicos de erros do Postgres (código, tabela, coluna). */
  private describeCause(exception: unknown): string {
    if (exception instanceof Error) {
      const pgError = exception as Error & { code?: string; detail?: string; table?: string; column?: string };
      const parts = [pgError.message];
      if (pgError.code) parts.push(`code=${pgError.code}`);
      if (pgError.table) parts.push(`table=${pgError.table}`);
      if (pgError.column) parts.push(`column=${pgError.column}`);
      if (pgError.detail) parts.push(`detail=${pgError.detail}`);
      return parts.join(' | ');
    }
    return JSON.stringify(exception);
  }
}
