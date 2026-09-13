import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/database/database.constants';
import { FakePgPool } from './utils/fake-pg-pool';

describe('Transactions (e2e)', () => {
  let app: INestApplication<App>;
  let fakePool: FakePgPool;

  const password = 'senha123';

  beforeEach(async () => {
    fakePool = new FakePgPool();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useValue(fakePool)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function registerUser(overrides: Partial<Record<string, string>> = {}) {
    const payload = {
      fullName: 'Usuário Teste',
      email: `user-${randomUUID()}@example.com`,
      password,
      cpf: overrides.cpf ?? String(Math.floor(10_000_000_000 + Math.random() * 89_999_999_999)),
      phoneNumber: '5511999999999',
      ...overrides,
    };
    const response = await request(app.getHttpServer()).post('/users/register').send(payload);
    const account = fakePool.getAccountsByUserId(response.body.user.id)[0];
    return {
      userId: response.body.user.id as string,
      cpf: payload.cpf,
      accessToken: response.body.accessToken as string,
      accountNumber: account.account_number,
    };
  }

  async function transfer(accessToken: string, overrides: Partial<Record<string, unknown>> = {}) {
    return request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: '100.00',
        idempotencyKey: randomUUID(),
        password,
        ...overrides,
      });
  }

  describe('POST /transactions', () => {
    it('deve transferir por número da conta e ajustar os saldos de origem e destino', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');

      const response = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ status: 'COMPLETED', amount: '100.00' });
      expect(fakePool.getAccountsByUserId(origin.userId)[0].cached_balance).toBe('400.00');
      expect(fakePool.getAccountsByUserId(destination.userId)[0].cached_balance).toBe('100.00');
    });

    it('deve transferir por CPF do destinatário', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');

      const response = await transfer(origin.accessToken, { destinationCpf: destination.cpf });

      expect(response.status).toBe(201);
      expect(fakePool.getAccountsByUserId(destination.userId)[0].cached_balance).toBe('100.00');
    });

    it('deve rejeitar com senha de acesso incorreta', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');

      const response = await transfer(origin.accessToken, {
        destinationAccountNumber: destination.accountNumber,
        password: 'senha-errada',
      });

      expect(response.status).toBe(401);
      expect(fakePool.getAccountsByUserId(origin.userId)[0].cached_balance).toBe('500.00');
    });

    it('deve repetir a mesma transação ao reenviar o mesmo idempotencyKey (retry seguro)', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');
      const idempotencyKey = randomUUID();

      const first = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber, idempotencyKey });
      const second = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber, idempotencyKey });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(fakePool.getAccountsByUserId(origin.userId)[0].cached_balance).toBe('400.00');
    });

    it('deve rejeitar quando o saldo for insuficiente', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '50.00');

      const response = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber });

      expect(response.status).toBe(409);
      expect(fakePool.getAccountsByUserId(origin.userId)[0].cached_balance).toBe('50.00');
    });

    it('deve rejeitar quando a conta de destino não existir', async () => {
      const origin = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');

      const response = await transfer(origin.accessToken, { destinationAccountNumber: '0000000000' });

      expect(response.status).toBe(404);
    });

    it('deve rejeitar transferência para a própria conta', async () => {
      const origin = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');

      const response = await transfer(origin.accessToken, { destinationAccountNumber: origin.accountNumber });

      expect(response.status).toBe(400);
    });

    it('deve rejeitar sem token de autenticação', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .send({ destinationAccountNumber: '1234567890', amount: '10.00', idempotencyKey: randomUUID(), password });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /transactions e GET /transactions/:id', () => {
    it('deve listar e buscar a transação criada', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');
      const created = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber });

      const list = await request(app.getHttpServer())
        .get('/transactions')
        .set('Authorization', `Bearer ${origin.accessToken}`);
      const byId = await request(app.getHttpServer())
        .get(`/transactions/${created.body.id}`)
        .set('Authorization', `Bearer ${origin.accessToken}`);

      expect(list.status).toBe(200);
      expect(list.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id })]));
      expect(byId.status).toBe(200);
      expect(byId.body.id).toBe(created.body.id);
    });

    it('deve retornar 404 para transação inexistente', async () => {
      const origin = await registerUser();

      const response = await request(app.getHttpServer())
        .get(`/transactions/${randomUUID()}`)
        .set('Authorization', `Bearer ${origin.accessToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /transactions/reversals', () => {
    it('deve reverter uma transferência concluída e devolver o saldo à origem', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');
      const created = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber });

      const response = await request(app.getHttpServer())
        .post('/transactions/reversals')
        .set('Authorization', `Bearer ${origin.accessToken}`)
        .send({ transactionId: created.body.id, reason: 'transferência feita por engano' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ type: 'REVERSAL', reversalOfId: created.body.id });
      expect(fakePool.getAccountsByUserId(origin.userId)[0].cached_balance).toBe('500.00');
      expect(fakePool.getAccountsByUserId(destination.userId)[0].cached_balance).toBe('0.00');
    });

    it('deve rejeitar reverter a mesma transação duas vezes', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');
      const created = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber });

      await request(app.getHttpServer())
        .post('/transactions/reversals')
        .set('Authorization', `Bearer ${origin.accessToken}`)
        .send({ transactionId: created.body.id, reason: 'transferência feita por engano' });

      const second = await request(app.getHttpServer())
        .post('/transactions/reversals')
        .set('Authorization', `Bearer ${origin.accessToken}`)
        .send({ transactionId: created.body.id, reason: 'tentando reverter de novo' });

      expect(second.status).toBe(409);
    });

    it('deve rejeitar reverter uma transação que não pertence ao usuário', async () => {
      const origin = await registerUser();
      const destination = await registerUser();
      const outsider = await registerUser();
      fakePool.fundAccount(origin.userId, '500.00');
      const created = await transfer(origin.accessToken, { destinationAccountNumber: destination.accountNumber });

      const response = await request(app.getHttpServer())
        .post('/transactions/reversals')
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ transactionId: created.body.id, reason: 'tentando reverter transação alheia' });

      expect(response.status).toBe(404);
    });
  });
});
