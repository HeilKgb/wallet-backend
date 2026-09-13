import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Pool } from 'pg';
import { AccountStatus, TransactionStatus, TransactionType } from '../common/enums';
import { PG_POOL } from '../database/database.constants';
import { UsersService } from '../users/users.service';
import { maskAccountNumber, maskCpf } from '../common/utils/log-mask.util';
import {
  CreateReversalRequestDto,
  CreateTransferDto,
  TransactionResponseDto,
} from './dto/transitions.dto';

interface TransactionRow {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: string;
  description: string | null;
  origin_account_id: string | null;
  destination_account_id: string | null;
  reversal_of_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  currency: string;
  cached_balance: string;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly usersService: UsersService,
  ) {}

  async createTransfer(userId: string, dto: CreateTransferDto): Promise<TransactionResponseDto> {
    const destinationLabel = dto.destinationCpf
      ? `cpf=${maskCpf(dto.destinationCpf)}`
      : `conta=${maskAccountNumber(dto.destinationAccountNumber)}`;
    this.logger.log(
      `Transferência solicitada: userId=${userId} ${destinationLabel} valor=${dto.amount} idempotencyKey=${dto.idempotencyKey}`,
    );

    await this.usersService.verifyAccessPassword(userId, dto.password);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const sourceResult = await client.query<AccountRow>(
        `SELECT id, user_id, currency, cached_balance
        FROM accounts
        WHERE user_id = $1 AND status = $2
        FOR UPDATE`,
        [userId, AccountStatus.ACTIVE],
      );
      const source = sourceResult.rows[0];
      if (!source) {
        throw new NotFoundException('conta de origem não encontrada');
      }

      const existingResult = await client.query<TransactionRow>(
        `SELECT id, type, status, amount, currency, description,
                origin_account_id, destination_account_id, reversal_of_id,
                created_at, completed_at
        FROM transactions
        WHERE idempotency_key = $1 AND origin_account_id = $2`,
        [dto.idempotencyKey, source.id],
      );
      if (existingResult.rows[0]) {
        await client.query('COMMIT');
        return this.toResponseDto(existingResult.rows[0]);
      }

      if (!dto.destinationAccountNumber && !dto.destinationCpf) {
        throw new BadRequestException('informe o número da conta ou o CPF do destinatário');
      }
      if (dto.destinationAccountNumber && dto.destinationCpf) {
        throw new BadRequestException('informe apenas um identificador de destino: conta ou CPF');
      }

      if (this.toCents(source.cached_balance) < this.toCents(dto.amount)) {
        throw new ConflictException('saldo insuficiente para realizar a transferência');
      }

      const destinationResult = dto.destinationCpf
        ? await client.query<AccountRow>(
            `SELECT a.id, a.user_id, a.currency, a.cached_balance
            FROM accounts a
            JOIN users u ON u.id = a.user_id
            WHERE u.cpf = $1 AND a.status = $2
            FOR UPDATE OF a`,
            [dto.destinationCpf, AccountStatus.ACTIVE],
          )
        : await client.query<AccountRow>(
            `SELECT id, user_id, currency, cached_balance
            FROM accounts
            WHERE account_number = $1 AND status = $2
            FOR UPDATE`,
            [dto.destinationAccountNumber, AccountStatus.ACTIVE],
          );
      const destination = destinationResult.rows[0];
      if (!destination) {
        throw new NotFoundException('conta de destino não encontrada');
      }
      if (destination.id === source.id) {
        throw new BadRequestException('a conta de destino deve ser diferente da conta de origem');
      }
      if (destination.currency !== source.currency) {
        throw new ConflictException('as contas precisam usar a mesma moeda');
      }

      const debitResult = await client.query(
        `UPDATE accounts
        SET cached_balance = cached_balance - $1
        WHERE id = $2 AND cached_balance >= $1`,
        [dto.amount, source.id],
      );
      if (debitResult.rowCount !== 1) {
        throw new ConflictException('saldo insuficiente ou inconsistente');
      }

      const creditResult = await client.query(
        `UPDATE accounts
        SET cached_balance = cached_balance + $1
        WHERE id = $2`,
        [dto.amount, destination.id],
      );
      if (creditResult.rowCount !== 1) {
        throw new ConflictException('conta de destino inconsistente');
      }

      const transactionResult = await client.query<TransactionRow>(
        `INSERT INTO transactions
          (type, status, amount, currency, description, origin_account_id,
          destination_account_id, idempotency_key, initiated_by_id, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id, type, status, amount, currency, description,
        origin_account_id, destination_account_id, reversal_of_id,
        created_at, completed_at`,
        [
          TransactionType.TRANSFER,
          TransactionStatus.COMPLETED,
          dto.amount,
          source.currency,
          dto.description ?? null,
          source.id,
          destination.id,
          dto.idempotencyKey,
          userId,
        ],
      );

      await client.query('COMMIT');
      this.logger.log(
        `Transferência concluída: transactionId=${transactionResult.rows[0].id} origem=${source.id} destino=${destination.id} valor=${dto.amount}`,
      );
      return this.toResponseDto(transactionResult.rows[0]);
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw this.mapTransactionError(error, 'não foi possível concluir a transferência', {
        userId,
        idempotencyKey: dto.idempotencyKey,
      });
    } finally {
      client.release();
    }
  }

  async findAll(): Promise<TransactionResponseDto[]> {
    const result = await this.pool.query<TransactionRow>(
      `SELECT id, type, status, amount, currency, description,
              origin_account_id, destination_account_id, reversal_of_id,
              created_at, completed_at
      FROM transactions
      ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => this.toResponseDto(row));
  }

  async findById(id: string): Promise<TransactionResponseDto> {
    const result = await this.pool.query<TransactionRow>(
      `SELECT id, type, status, amount, currency, description,
              origin_account_id, destination_account_id, reversal_of_id,
              created_at, completed_at
      FROM transactions
      WHERE id = $1`,
      [id],
    );
    const transaction = result.rows[0];
    if (!transaction) {
      throw new NotFoundException('transação não encontrada');
    }
    return this.toResponseDto(transaction);
  }

  async reverse(userId: string, dto: CreateReversalRequestDto): Promise<TransactionResponseDto> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const transactionResult = await client.query<TransactionRow>(
        `SELECT t.id, t.type, t.status, t.amount, t.currency, t.description,
                t.origin_account_id, t.destination_account_id, t.reversal_of_id,
                t.created_at, t.completed_at
        FROM transactions t
        JOIN accounts origin ON origin.id = t.origin_account_id
        WHERE t.id = $1 AND origin.user_id = $2
        FOR UPDATE`,
        [dto.transactionId, userId],
      );
      const transaction = transactionResult.rows[0];
      if (!transaction) {
        throw new NotFoundException('transação não encontrada ou não pertence ao usuário');
      }
      if (transaction.type !== TransactionType.TRANSFER || transaction.status !== TransactionStatus.COMPLETED) {
        throw new ConflictException('somente transferências concluídas podem ser revertidas');
      }

      const reversalResult = await client.query<{ id: string }>(
        `SELECT id FROM transactions WHERE reversal_of_id = $1 FOR UPDATE`,
        [transaction.id],
      );
      if (reversalResult.rows[0]) {
        throw new ConflictException('a transação já foi revertida');
      }

      if (!transaction.origin_account_id || !transaction.destination_account_id) {
        throw new ConflictException('transação inconsistente: contas ausentes');
      }

      const debitResult = await client.query(
        `UPDATE accounts
        SET cached_balance = cached_balance - $1
        WHERE id = $2 AND cached_balance >= $1`,
        [transaction.amount, transaction.destination_account_id],
      );
      if (debitResult.rowCount !== 1) {
        throw new ConflictException('saldo da conta de destino insuficiente para reverter');
      }

      const creditResult = await client.query(
        `UPDATE accounts
        SET cached_balance = cached_balance + $1
        WHERE id = $2`,
        [transaction.amount, transaction.origin_account_id],
      );
      if (creditResult.rowCount !== 1) {
        throw new ConflictException('conta de origem inconsistente');
      }

      const newTransactionResult = await client.query<TransactionRow>(
        `INSERT INTO transactions
          (type, status, amount, currency, description, origin_account_id,
          destination_account_id, reversal_of_id, idempotency_key, initiated_by_id, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING id, type, status, amount, currency, description,
        origin_account_id, destination_account_id, reversal_of_id,
        created_at, completed_at`,
        [
          TransactionType.REVERSAL,
          TransactionStatus.COMPLETED,
          transaction.amount,
          transaction.currency,
          dto.reason,
          transaction.destination_account_id,
          transaction.origin_account_id,
          transaction.id,
          `reversal:${transaction.id}`,
          userId,
        ],
      );

      await client.query(
        `UPDATE transactions
        SET status = $1, completed_at = COALESCE(completed_at, NOW())
        WHERE id = $2`,
        [TransactionStatus.REVERSED, transaction.id],
      );

      await client.query('COMMIT');
      this.logger.log(
        `Reversão concluída: transactionId=${newTransactionResult.rows[0].id} reversalOf=${transaction.id} userId=${userId}`,
      );
      return this.toResponseDto(newTransactionResult.rows[0]);
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw this.mapTransactionError(error, 'não foi possível reverter a transação', {
        userId,
        transactionId: dto.transactionId,
      });
    } finally {
      client.release();
    }
  }

  private toResponseDto(row: TransactionRow): TransactionResponseDto {
    return plainToInstance(
      TransactionResponseDto,
      {
        id: row.id,
        type: row.type,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        description: row.description,
        originAccountId: row.origin_account_id,
        destinationAccountId: row.destination_account_id,
        reversalOfId: row.reversal_of_id,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      },
      { excludeExtraneousValues: true },
    );
  }

  private toCents(value: string): bigint {
    const [integerPart, fractionPart = ''] = value.split('.');
    return BigInt(integerPart) * 100n + BigInt(fractionPart.padEnd(2, '0').slice(0, 2));
  }

  private mapTransactionError(error: unknown, message: string, context: Record<string, unknown>): Error {
    if (error instanceof HttpException) {
      return error;
    }

    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505') {
      this.logger.warn(`idempotencyKey duplicada: ${JSON.stringify(context)}`);
      return new ConflictException('idempotencyKey já foi utilizado em outra transferência');
    }

    const pgError = error as Error & { code?: string; detail?: string; table?: string; column?: string };
    this.logger.error(
      `Erro inesperado em transação | contexto=${JSON.stringify(context)} | ` +
        `causa="${pgError?.message}" pgCode=${pgError?.code} table=${pgError?.table} column=${pgError?.column} detail=${pgError?.detail}`,
      pgError?.stack,
    );

    return new InternalServerErrorException(message);
  }
}