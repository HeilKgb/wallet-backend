import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { AppConfig } from '../config/configuration';
import { PG_POOL } from '../database/database.constants';
import { JwtPayload } from './jwt-payload.interface';

type RefreshTokenStatus = 'ACTIVE' | 'ROTATED' | 'REVOKED';

interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  status: RefreshTokenStatus;
  expires_at: Date;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Requer a tabela `refresh_tokens` (id uuid pk, user_id uuid, family_id uuid,
 * token_hash text unique, status text, expires_at timestamptz, created_at timestamptz default now()).
 */
@Injectable()
export class TokenService {
  private readonly refreshTtlSeconds: number;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwtService: JwtService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.refreshTtlSeconds = configService.get('auth', { infer: true }).refreshTokenExpiresInSeconds;
  }

  /** Emite o par inicial de tokens e abre uma nova família de rotação. */
  async issueTokenPair(userId: string, email: string): Promise<TokenPair> {
    return this.issueForFamily(userId, email, randomUUID());
  }

  /**
   * Rotaciona o refresh token: cada token só pode ser trocado uma vez.
   * Reapresentar um token já rotacionado/revogado ou expirado é tratado como
   * indício de roubo e revoga toda a família (todas as sessões dela).
   */
  async rotateRefreshToken(rawToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const result = await this.pool.query<RefreshTokenRow>(
      `SELECT rt.id, rt.user_id, rt.family_id, rt.status, rt.expires_at, u.email
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];

    if (!row) {
      throw new UnauthorizedException('refresh token inválido');
    }

    if (row.status !== 'ACTIVE' || row.expires_at.getTime() < Date.now()) {
      await this.revokeFamilyById(row.family_id);
      throw new UnauthorizedException('refresh token inválido, expirado ou reutilizado; sessão revogada');
    }

    await this.pool.query(`UPDATE refresh_tokens SET status = 'ROTATED' WHERE id = $1`, [row.id]);

    return this.issueForFamily(row.user_id, row.email, row.family_id);
  }

  /** Revoga toda a família do refresh token informado (logout). */
  async revokeFamily(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const result = await this.pool.query<{ family_id: string }>(
      `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const familyId = result.rows[0]?.family_id;
    if (familyId) {
      await this.revokeFamilyById(familyId);
    }
  }

  private async revokeFamilyById(familyId: string): Promise<void> {
    await this.pool.query(`UPDATE refresh_tokens SET status = 'REVOKED' WHERE family_id = $1 AND status <> 'REVOKED'`, [
      familyId,
    ]);
  }

  private async issueForFamily(userId: string, email: string, familyId: string): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync({ sub: userId, email } satisfies JwtPayload);

    const rawRefreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);

    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, status, expires_at)
       VALUES ($1, $2, $3, 'ACTIVE', $4)`,
      [userId, familyId, this.hashToken(rawRefreshToken), expiresAt],
    );

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private hashToken(rawToken: string): string {
    // Tokens de 256 bits de entropia: SHA-256 já é suficiente, sem necessidade de salt/custo (não é senha).
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
