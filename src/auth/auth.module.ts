import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/configuration';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const auth = configService.get('auth', { infer: true });
        return {
          secret: auth.jwtSecret,
          signOptions: { expiresIn: auth.jwtExpiresInSeconds },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard, TokenService],
  exports: [JwtModule, JwtAuthGuard, TokenService],
})
export class AuthModule {}
