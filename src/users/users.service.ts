import { randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { AccountStatus, AuthProvider, UserStatus } from '../common/enums';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';
import { TokenService } from '../auth/token.service';
import { maskCpf, maskEmail } from '../common/utils/log-mask.util';
import { LoginDto, LoginSocialDto, RegisterLocalDto, RegisterSocialDto, UpdateUserDto, UserResponseDto } from './dto/login.dto';

const scrypt = promisify(_scrypt);
const SCRYPT_KEYLEN = 64;

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  cpf: string;
  phone_number: string;
  password_hash: string | null;
  auth_provider: AuthProvider;
  status: UserStatus;
  created_at: Date;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tokenService: TokenService,
  ) {}

  async registerLocal(dto: RegisterLocalDto): Promise<AuthResponseDto> {
    this.logger.log(`Registro solicitado: email=${maskEmail(dto.email)} cpf=${maskCpf(dto.cpf)}`);

    const passwordHash = await this.hashPassword(dto.password);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query<UserRow>(
        `INSERT INTO users (full_name, email, cpf, phone_number, password_hash, auth_provider, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [dto.fullName, dto.email, dto.cpf, dto.phoneNumber, passwordHash, AuthProvider.LOCAL, UserStatus.ACTIVE],
      );
      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO accounts (user_id, account_number, currency, cached_balance, status)
        VALUES ($1, $2, $3, $4, $5)`,
        [user.id, this.generateAccountNumber(), 'BRL', '1000.00', AccountStatus.ACTIVE],
      );

      await client.query('COMMIT');
      this.logger.log(`Usuário registrado com sucesso: userId=${user.id}`);
      return this.toAuthResponse(user);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw this.mapUniqueViolation(error, { operation: 'registerLocal', email: maskEmail(dto.email) });
    } finally {
      client.release();
    }
  }
private generateAccountNumber(): string {
  return randomInt(1_000_000_000, 9_999_999_999).toString();
}

  async registerSocial(_dto: RegisterSocialDto): Promise<AuthResponseDto> {
    // Requer firebase-admin para validar o idToken e extrair uid/provider com segurança.
    throw new NotImplementedException('Cadastro social ainda não está configurado');
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [dto.email]);
    const user = result.rows[0];

    const passwordHash = user?.password_hash;
    const passwordMatches = passwordHash ? await this.verifyPassword(dto.password, passwordHash) : false;
    if (!passwordMatches) {
      this.logger.warn(`Login falhou (credenciais inválidas): email=${maskEmail(dto.email)}`);
      throw new UnauthorizedException('email ou senha inválidos');
    }

    if (user.status === UserStatus.BLOCKED) {
      this.logger.warn(`Login negado (usuário bloqueado): userId=${user.id}`);
      throw new ForbiddenException('usuário bloqueado');
    }

    this.logger.log(`Login bem-sucedido: userId=${user.id}`);
    return this.toAuthResponse(user);
  }

  async loginSocial(_dto: LoginSocialDto): Promise<AuthResponseDto> {
    // Requer firebase-admin para validar o idToken e extrair uid/provider com segurança.
    throw new NotImplementedException('Login social ainda não está configurado');
  }

  /** Confirma a senha de acesso do usuário autenticado; usado para reautenticar ações sensíveis (ex: transferências). */
  async verifyAccessPassword(id: string, password: string): Promise<void> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    const user = result.rows[0];

    const passwordMatches = user?.password_hash ? await this.verifyPassword(password, user.password_hash) : false;
    if (!passwordMatches) {
      this.logger.warn(`Reautenticação falhou (ação sensível bloqueada): userId=${id}`);
      throw new UnauthorizedException('senha inválida');
    }
  }

  async findById(id: string): Promise<UserResponseDto> {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    const user = result.rows[0];

    if (!user) {
      throw new NotFoundException('usuário não encontrado');
    }

    return this.toResponseDto(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    try {
      const result = await this.pool.query<UserRow>(
        `UPDATE users
         SET full_name = COALESCE($1, full_name),
             email = COALESCE($2, email),
             phone_number = COALESCE($3, phone_number)
         WHERE id = $4
         RETURNING *`,
        [dto.fullName ?? null, dto.email ?? null, dto.phoneNumber ?? null, id],
      );

      if (!result.rows[0]) {
        throw new NotFoundException('usuário não encontrado');
      }

      return this.toResponseDto(result.rows[0]);
    } catch (error: unknown) {
      throw this.mapUniqueViolation(error, { operation: 'update', userId: id });
    }
  }

  async freeze(id: string): Promise<UserResponseDto> {
    const result = await this.pool.query<UserRow>(
      `UPDATE users
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [UserStatus.BLOCKED, id],
    );

    if (!result.rows[0]) {
      throw new NotFoundException('usuário não encontrado');
    }

    return this.toResponseDto(result.rows[0]);
  }

  private async toAuthResponse(row: UserRow): Promise<AuthResponseDto> {
    const user = this.toResponseDto(row);
    const { accessToken, refreshToken } = await this.tokenService.issueTokenPair(user.id, user.email);
    return { user, accessToken, refreshToken };
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
    return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) {
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const storedHash = Buffer.from(hashHex, 'hex');
    const derivedKey = (await scrypt(password, salt, storedHash.length)) as Buffer;

    return derivedKey.length === storedHash.length && timingSafeEqual(derivedKey, storedHash);
  }

  private toResponseDto(row: UserRow): UserResponseDto {
    return plainToInstance(
      UserResponseDto,
      {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        cpf: row.cpf,
        phoneNumber: row.phone_number,
        authProvider: row.auth_provider,
        status: row.status,
        createdAt: row.created_at,
      },
      { excludeExtraneousValues: true },
    );
  }

  private mapUniqueViolation(error: unknown, context: Record<string, unknown>): unknown {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505') {
      this.logger.warn(`Cadastro rejeitado (email/CPF duplicado): ${JSON.stringify(context)}`);
      return new ConflictException('email ou CPF já cadastrado');
    }

    const pgError = error as Error & { code?: string; detail?: string };
    this.logger.error(
      `Erro inesperado em operação de usuário | contexto=${JSON.stringify(context)} | causa="${pgError?.message}" pgCode=${pgError?.code} detail=${pgError?.detail}`,
      pgError?.stack,
    );
    return error;
  }
}
