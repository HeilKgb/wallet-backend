import { jest } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { UsersService } from '../users/users.service';
import { CreateReversalRequestDto, CreateTransferDto } from './dto/transitions.dto';
import { TransactionStatus } from '../common/enums/transaction-status.enum';
import { TransactionType } from '../common/enums/transaction-type.enum';

const userId = 'user-1111-1111-1111-111111111111';

const sourceAccount = {
  id: 'account-origin',
  user_id: userId,
  currency: 'BRL',
  cached_balance: '500.00',
};

const destinationAccount = {
  id: 'account-destination',
  user_id: 'user-2222-2222-2222-222222222222',
  currency: 'BRL',
  cached_balance: '10.00',
};

const transactionRow = {
  id: 'transaction-1',
  type: TransactionType.TRANSFER,
  status: TransactionStatus.COMPLETED,
  amount: '100.00',
  currency: 'BRL',
  description: null,
  origin_account_id: sourceAccount.id,
  destination_account_id: destinationAccount.id,
  reversal_of_id: null,
  created_at: new Date('2026-09-12T00:00:00.000Z'),
  completed_at: new Date('2026-09-12T00:00:00.000Z'),
};

/** Fila de respostas simulando o client do pg: cada chamada a `query` consome o próximo item. */
function createMockClient(responses: Array<{ rows?: unknown[]; rowCount?: number }>) {
  const queue = [...responses];
  const query = jest.fn(async () => queue.shift() ?? { rows: [], rowCount: 0 });
  const release = jest.fn();
  return { query, release } as unknown as { query: jest.Mock; release: jest.Mock };
}

function buildTransferDto(overrides: Partial<CreateTransferDto> = {}): CreateTransferDto {
  return {
    destinationAccountNumber: '9999999999',
    amount: '100.00',
    idempotencyKey: '2f4d6f0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    password: 'senha123',
    ...overrides,
  } as CreateTransferDto;
}

describe('TransactionsService', () => {
  let usersService: jest.Mocked<UsersService>;
  let pool: { connect: jest.Mock; query: jest.Mock };
  let service: TransactionsService;

  beforeEach(() => {
    usersService = { verifyAccessPassword: jest.fn() } as unknown as jest.Mocked<UsersService>;
    usersService.verifyAccessPassword.mockResolvedValue(undefined);
    pool = { connect: jest.fn(), query: jest.fn() };
    service = new TransactionsService(pool as never, usersService);
  });

  describe('createTransfer', () => {
    it('deve rejeitar a transferência quando a senha de acesso for inválida, sem abrir conexão', async () => {
      usersService.verifyAccessPassword.mockRejectedValue(new UnauthorizedException('senha inválida'));

      await expect(service.createTransfer(userId, buildTransferDto())).rejects.toBeInstanceOf(UnauthorizedException);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('deve concluir uma transferência válida debitando a origem e creditando o destino', async () => {
      const client = createMockClient([
        { rows: [] }, // BEGIN
        { rows: [sourceAccount] }, // SELECT origem FOR UPDATE
        { rows: [] }, // SELECT idempotência (nenhuma existente)
        { rows: [destinationAccount] }, // SELECT destino FOR UPDATE
        { rows: [], rowCount: 1 }, // UPDATE débito
        { rows: [], rowCount: 1 }, // UPDATE crédito
        { rows: [transactionRow] }, // INSERT transação
        { rows: [] }, // COMMIT
      ]);
      pool.connect.mockResolvedValue(client);

      const result = await service.createTransfer(userId, buildTransferDto());

      expect(result).toMatchObject({ id: transactionRow.id, status: TransactionStatus.COMPLETED });
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('deve retornar a transação existente ao repetir o mesmo idempotencyKey (retry seguro)', async () => {
      const client = createMockClient([
        { rows: [] }, // BEGIN
        { rows: [sourceAccount] }, // SELECT origem FOR UPDATE
        { rows: [transactionRow] }, // SELECT idempotência (já existe)
        { rows: [] }, // COMMIT
      ]);
      pool.connect.mockResolvedValue(client);

      const result = await service.createTransfer(userId, buildTransferDto());

      expect(result).toMatchObject({ id: transactionRow.id });
      // Não deve tentar debitar/creditar de novo.
      expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE accounts'), expect.anything());
    });

    it('deve rejeitar quando não informar conta nem CPF de destino', async () => {
      const client = createMockClient([
        { rows: [] }, // BEGIN
        { rows: [sourceAccount] }, // SELECT origem
        { rows: [] }, // SELECT idempotência
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(
        service.createTransfer(userId, buildTransferDto({ destinationAccountNumber: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('deve rejeitar quando a conta de destino não existir', async () => {
      const client = createMockClient([
        { rows: [] },
        { rows: [sourceAccount] },
        { rows: [] },
        { rows: [] }, // destino não encontrado
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(service.createTransfer(userId, buildTransferDto())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deve rejeitar transferência para a própria conta', async () => {
      const client = createMockClient([
        { rows: [] },
        { rows: [sourceAccount] },
        { rows: [] },
        { rows: [sourceAccount] }, // destino igual à origem
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(service.createTransfer(userId, buildTransferDto())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deve rejeitar quando o saldo for insuficiente (débito afeta 0 linhas)', async () => {
      const client = createMockClient([
        { rows: [] },
        { rows: [sourceAccount] },
        { rows: [] },
        { rows: [destinationAccount] },
        { rows: [], rowCount: 0 }, // débito falhou
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(service.createTransfer(userId, buildTransferDto())).rejects.toBeInstanceOf(ConflictException);
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('deve verificar o saldo antes de buscar a conta de destino', async () => {
      const client = createMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ ...sourceAccount, cached_balance: '50.00' }] }, // SELECT origem FOR UPDATE
        { rows: [] }, // SELECT idempotência (nenhuma existente)
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(service.createTransfer(userId, buildTransferDto())).rejects.toThrow(
        'saldo insuficiente para realizar a transferência',
      );
      expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('account_number = $1'), expect.anything());
    });

    it('deve rejeitar quando a conta de origem não existir', async () => {
      const client = createMockClient([{ rows: [] }, { rows: [] }]);
      pool.connect.mockResolvedValue(client);

      await expect(service.createTransfer(userId, buildTransferDto())).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAll / findById', () => {
    it('deve listar todas as transações', async () => {
      pool.query.mockResolvedValue({ rows: [transactionRow] });

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: transactionRow.id });
    });

    it('deve lançar NotFoundException quando a transação não existir', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await expect(service.findById('inexistente')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reverse', () => {
    function buildReversalDto(): CreateReversalRequestDto {
      return { transactionId: transactionRow.id, reason: 'transferência feita por engano' } as CreateReversalRequestDto;
    }

    it('deve reverter uma transferência concluída, creditando de volta a origem', async () => {
      const client = createMockClient([
        { rows: [] }, // BEGIN
        { rows: [transactionRow] }, // SELECT transação (dono)
        { rows: [] }, // SELECT reversalOfId (nenhuma reversão existente)
        { rows: [], rowCount: 1 }, // UPDATE débito destino
        { rows: [], rowCount: 1 }, // UPDATE crédito origem
        { rows: [{ ...transactionRow, id: 'transaction-2', type: TransactionType.REVERSAL, reversal_of_id: transactionRow.id }] },
        { rows: [] }, // UPDATE status da transação original
        { rows: [] }, // COMMIT
      ]);
      pool.connect.mockResolvedValue(client);

      const result = await service.reverse(userId, buildReversalDto());

      expect(result).toMatchObject({ type: TransactionType.REVERSAL, reversalOfId: transactionRow.id });
    });

    it('deve rejeitar reverter uma transação que não pertence ao usuário', async () => {
      const client = createMockClient([{ rows: [] }, { rows: [] }]);
      pool.connect.mockResolvedValue(client);

      await expect(service.reverse(userId, buildReversalDto())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deve rejeitar reverter uma transação já revertida', async () => {
      const client = createMockClient([
        { rows: [] },
        { rows: [transactionRow] },
        { rows: [{ id: 'transaction-2' }] }, // já existe reversão
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(service.reverse(userId, buildReversalDto())).rejects.toBeInstanceOf(ConflictException);
    });

    it('deve rejeitar reverter uma transação que não está concluída', async () => {
      const client = createMockClient([
        { rows: [] },
        { rows: [{ ...transactionRow, status: TransactionStatus.PENDING }] },
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(service.reverse(userId, buildReversalDto())).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
