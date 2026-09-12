import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AppConfig } from '../config/configuration';
import { PG_POOL } from './database.constants';

const logger = new Logger('DatabaseModule');

export const databaseProviders: Provider[] = [
  {
    provide: PG_POOL,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<AppConfig, true>): Pool => {
      const dbConfig = configService.get('database', { infer: true });

      const pool = dbConfig.connectionString
        ? new Pool({
            connectionString: dbConfig.connectionString,
            ssl: dbConfig.ssl ? { rejectUnauthorized: dbConfig.sslRejectUnauthorized } : undefined,
            max: dbConfig.poolMax,
            idleTimeoutMillis: dbConfig.idleTimeoutMillis,
          })
        : new Pool({
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            password: dbConfig.password,
            database: dbConfig.database,
            ssl: dbConfig.ssl ? { rejectUnauthorized: dbConfig.sslRejectUnauthorized } : undefined,
            max: dbConfig.poolMax,
            idleTimeoutMillis: dbConfig.idleTimeoutMillis,
          });

      // Sem isso, um erro num cliente ocioso do pool derruba o processo Node inteiro.
      pool.on('error', (err) => {
        logger.error('Erro inesperado em cliente ocioso do pool do Postgres', err.stack);
      });

      return pool;
    },
  },
];
