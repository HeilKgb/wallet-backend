import { Global, Module, OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { databaseProviders } from './database.providers';
import { PG_POOL } from './database.constants';

/**
 * Módulo global: uma vez importado no AppModule, o Pool (PG_POOL) fica
 * disponível para injeção em qualquer outro módulo, sem precisar reimportar.
 */
@Global()
@Module({
  providers: [...databaseProviders],
  exports: [...databaseProviders],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Fecha as conexões do pool de forma limpa quando a aplicação Nest é encerrada.
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    this.logger.log('Pool de conexões com o Postgres encerrado.');
  }
}
