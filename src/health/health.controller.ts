import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Public()
  @Get()
  async check() {
    try {
      const result = await this.pool.query('SELECT NOW() AS server_time');
      return {
        status: 'ok',
        database: 'connected',
        serverTime: result.rows[0].server_time,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Falha no healthcheck do banco: ${message}`);
      throw new ServiceUnavailableException('Não foi possível conectar ao banco de dados');
    }
  }
}
