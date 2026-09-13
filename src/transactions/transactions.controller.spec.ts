import { jest } from '@jest/globals';
import type { Request } from 'express';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { CreateReversalRequestDto, CreateTransferDto, TransactionResponseDto } from './dto/transitions.dto';
import { TransactionStatus } from '../common/enums/transaction-status.enum';
import { TransactionType } from '../common/enums/transaction-type.enum';

const userId = '8f5d5c9e-5d22-4f3f-8f90-7e2d5cf4a123';

const transactionResponse: TransactionResponseDto = {
  id: 'a1c1e2d3-1111-4f3f-8f90-7e2d5cf4a999',
  type: TransactionType.TRANSFER,
  status: TransactionStatus.COMPLETED,
  amount: '100.00',
  currency: 'BRL',
  description: null,
  originAccountId: 'origin-id',
  destinationAccountId: 'destination-id',
  reversalOfId: null,
  createdAt: new Date('2026-09-12T00:00:00.000Z'),
  completedAt: new Date('2026-09-12T00:00:00.000Z'),
};

function buildRequest(): Request {
  return { user: { sub: userId, email: 'maria@example.com' } } as unknown as Request;
}

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let service: jest.Mocked<TransactionsService>;

  beforeEach(() => {
    service = {
      createTransfer: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      reverse: jest.fn(),
    } as unknown as jest.Mocked<TransactionsService>;
    controller = new TransactionsController(service);
  });

  it('deve criar uma transferência usando o id do usuário autenticado', async () => {
    const dto = { destinationAccountNumber: '1234567890', amount: '100.00' } as CreateTransferDto;
    service.createTransfer.mockResolvedValue(transactionResponse);

    await expect(controller.createTransfer(buildRequest(), dto)).resolves.toBe(transactionResponse);
    expect(service.createTransfer).toHaveBeenCalledWith(userId, dto);
  });

  it('deve listar todas as transações', async () => {
    service.findAll.mockResolvedValue([transactionResponse]);

    await expect(controller.findAll()).resolves.toEqual([transactionResponse]);
    expect(service.findAll).toHaveBeenCalledWith();
  });

  it('deve buscar uma transação pelo id', async () => {
    service.findById.mockResolvedValue(transactionResponse);

    await expect(controller.findById(transactionResponse.id)).resolves.toBe(transactionResponse);
    expect(service.findById).toHaveBeenCalledWith(transactionResponse.id);
  });

  it('deve reverter uma transação usando o id do usuário autenticado', async () => {
    const dto = { transactionId: transactionResponse.id, reason: 'compra duplicada por engano' } as CreateReversalRequestDto;
    service.reverse.mockResolvedValue({ ...transactionResponse, type: TransactionType.REVERSAL });

    await expect(controller.reverse(buildRequest(), dto)).resolves.toEqual({
      ...transactionResponse,
      type: TransactionType.REVERSAL,
    });
    expect(service.reverse).toHaveBeenCalledWith(userId, dto);
  });
});
