export interface AppConfig {
  port: number;
  database: {
    connectionString?: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: boolean;
    sslRejectUnauthorized: boolean;
    poolMax: number;
    idleTimeoutMillis: number;
  };
}

const configuration = (): AppConfig => ({
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  database: {
    // Se DATABASE_URL estiver definida, ela tem prioridade (ex: ambientes gerenciados como Render/Railway/RDS).
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST ?? 'localhost',
    port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'postgres',
    ssl: process.env.DB_SSL === 'true',
    sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    poolMax: Number.parseInt(process.env.DB_POOL_MAX ?? '10', 10),
    idleTimeoutMillis: Number.parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
  },
});

export default configuration;
