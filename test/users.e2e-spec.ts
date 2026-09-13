import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/database/database.constants';
import { FakePgPool } from './utils/fake-pg-pool';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let fakePool: FakePgPool;

  const registerPayload = {
    fullName: 'Maria Silva',
    email: 'maria@example.com',
    password: 'senha123',
    cpf: '12345678901',
    phoneNumber: '5511999999999',
  };

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

  async function registerUser(overrides: Partial<typeof registerPayload> = {}) {
    const response = await request(app.getHttpServer())
      .post('/users/register')
      .send({ ...registerPayload, ...overrides });
    return response;
  }

  describe('POST /users/register', () => {
    it('deve cadastrar um usuário e criar a conta associada', async () => {
      const response = await registerUser();

      expect(response.status).toBe(201);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({
        email: registerPayload.email,
        fullName: registerPayload.fullName,
        status: 'ACTIVE',
      });
      expect(response.body.user.password).toBeUndefined();
      expect(response.body.user.passwordHash).toBeUndefined();

      const accounts = fakePool.getAccountsByUserId(response.body.user.id);
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({ currency: 'BRL', cached_balance: '1000.00', status: 'ACTIVE' });
    });

    it('deve rejeitar cadastro com e-mail inválido', async () => {
      const response = await registerUser({ email: 'email-invalido' });
      expect(response.status).toBe(400);
    });

    it('deve rejeitar cadastro com e-mail ou CPF já usados', async () => {
      await registerUser();
      const response = await registerUser();

      expect(response.status).toBe(409);
    });
  });

  describe('POST /users/login', () => {
    it('deve autenticar com credenciais corretas', async () => {
      await registerUser();

      const response = await request(app.getHttpServer())
        .post('/users/login')
        .send({ email: registerPayload.email, password: registerPayload.password });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user.email).toBe(registerPayload.email);
    });

    it('deve rejeitar login com senha incorreta', async () => {
      await registerUser();

      const response = await request(app.getHttpServer())
        .post('/users/login')
        .send({ email: registerPayload.email, password: 'senha-errada' });

      expect(response.status).toBe(401);
    });
  });

  describe('rotas protegidas por dono do recurso', () => {
    async function registerAndLogin(overrides: Partial<typeof registerPayload> = {}) {
      const response = await registerUser(overrides);
      return { userId: response.body.user.id as string, accessToken: response.body.accessToken as string };
    }

    it('deve rejeitar acesso sem token', async () => {
      const { userId } = await registerAndLogin();

      const response = await request(app.getHttpServer()).get(`/users/${userId}`);

      expect(response.status).toBe(401);
    });

    it('deve rejeitar acesso ao perfil de outro usuário', async () => {
      const userA = await registerAndLogin();
      const userB = await registerAndLogin({ email: 'outro@example.com', cpf: '98765432100' });

      const response = await request(app.getHttpServer())
        .get(`/users/${userB.userId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`);

      expect(response.status).toBe(403);
    });

    it('deve permitir que o próprio usuário consulte seus dados', async () => {
      const { userId, accessToken } = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(userId);
    });

    it('deve permitir que o próprio usuário atualize seus dados', async () => {
      const { userId, accessToken } = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .patch(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ phoneNumber: '5511888888888' });

      expect(response.status).toBe(200);
      expect(response.body.phoneNumber).toBe('5511888888888');
    });

    it('deve congelar a conta do próprio usuário e bloquear login futuro', async () => {
      const { userId, accessToken } = await registerAndLogin();

      const freezeResponse = await request(app.getHttpServer())
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(freezeResponse.status).toBe(200);
      expect(freezeResponse.body.status).toBe('BLOCKED');

      const loginResponse = await request(app.getHttpServer())
        .post('/users/login')
        .send({ email: registerPayload.email, password: registerPayload.password });

      expect(loginResponse.status).toBe(403);
    });
  });
});
