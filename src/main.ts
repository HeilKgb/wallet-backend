import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import { AppModule } from './app.module';

async function bootstrap() {
  const httpsOptions = buildHttpsOptions();
  const app = await NestFactory.create(AppModule, httpsOptions ? { httpsOptions } : undefined);
  await app.listen(process.env.PORT ?? 3000);
}

/** Ativa HTTPS somente quando TLS_CERT_PATH e TLS_KEY_PATH estiverem configurados. */
function buildHttpsOptions(): HttpsOptions | undefined {
  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;

  if (!certPath && !keyPath) {
    return undefined;
  }

  // Configuração parcial nunca deve fazer downgrade silencioso para HTTP.
  if (!certPath || !keyPath) {
    throw new Error('TLS_CERT_PATH e TLS_KEY_PATH devem ser definidos juntos');
  }

  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
}

bootstrap();
