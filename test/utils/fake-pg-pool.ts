import { randomUUID } from 'node:crypto';

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  cpf: string;
  phone_number: string;
  password_hash: string | null;
  auth_provider: string;
  status: string;
  created_at: Date;
}

interface AccountRow {
  id: string;
  user_id: string;
  account_number: string;
  currency: string;
  cached_balance: string;
  status: string;
}

interface QueryResult<T> {
  rows: T[];
}

interface UniqueViolationError extends Error {
  code: string;
}

function uniqueViolation(): UniqueViolationError {
  const error = new Error('duplicate key value violates unique constraint') as UniqueViolationError;
  error.code = '23505';
  return error;
}

/**
 * Substitui o Pool real do 'pg' nos testes de integração: simula as tabelas
 * `users`/`accounts` em memória, reconhecendo exatamente as queries usadas em UsersService.
 */
export class FakePgPool {
  private users: UserRow[] = [];
  private accounts: AccountRow[] = [];
  private snapshot: { users: UserRow[]; accounts: AccountRow[] } | null = null;

  async query<T = unknown>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.execute<T>(text, params);
  }

  async connect() {
    return {
      query: <T = unknown>(text: string, params: unknown[] = []) => this.execute<T>(text, params),
      release: () => {},
    };
  }

  /** Exigido pelo DatabaseModule.onApplicationShutdown ao encerrar a aplicação nos testes. */
  async end(): Promise<void> {}

  private async execute<T>(text: string, params: unknown[]): Promise<QueryResult<T>> {
    const sql = text.trim();

    if (sql.startsWith('BEGIN')) {
      this.snapshot = { users: [...this.users], accounts: [...this.accounts] };
      return { rows: [] as T[] };
    }

    if (sql.startsWith('COMMIT')) {
      this.snapshot = null;
      return { rows: [] as T[] };
    }

    if (sql.startsWith('ROLLBACK')) {
      if (this.snapshot) {
        this.users = this.snapshot.users;
        this.accounts = this.snapshot.accounts;
        this.snapshot = null;
      }
      return { rows: [] as T[] };
    }

    if (sql.startsWith('INSERT INTO users')) {
      return this.insertUser(params) as QueryResult<T>;
    }

    if (sql.startsWith('INSERT INTO accounts')) {
      return this.insertAccount(params) as QueryResult<T>;
    }

    if (sql.includes('SELECT * FROM users WHERE email')) {
      const [email] = params as [string];
      const found = this.users.find((user) => user.email === email);
      return { rows: (found ? [found] : []) as T[] };
    }

    if (sql.includes('SELECT * FROM users WHERE id')) {
      const [id] = params as [string];
      const found = this.users.find((user) => user.id === id);
      return { rows: (found ? [found] : []) as T[] };
    }

    if (sql.startsWith('UPDATE users') && sql.includes('full_name = COALESCE')) {
      return this.updateProfile(params) as QueryResult<T>;
    }

    if (sql.startsWith('UPDATE users') && sql.includes('SET status')) {
      return this.updateStatus(params) as QueryResult<T>;
    }

    throw new Error(`FakePgPool: query não suportada: ${sql}`);
  }

  private insertUser(params: unknown[]): QueryResult<UserRow> {
    const [fullName, email, cpf, phoneNumber, passwordHash, authProvider, status] = params as [
      string,
      string,
      string,
      string,
      string | null,
      string,
      string,
    ];

    if (this.users.some((user) => user.email === email || user.cpf === cpf)) {
      throw uniqueViolation();
    }

    const row: UserRow = {
      id: randomUUID(),
      full_name: fullName,
      email,
      cpf,
      phone_number: phoneNumber,
      password_hash: passwordHash,
      auth_provider: authProvider,
      status,
      created_at: new Date(),
    };
    this.users.push(row);
    return { rows: [row] };
  }

  private insertAccount(params: unknown[]): QueryResult<AccountRow> {
    const [userId, accountNumber, currency, cachedBalance, status] = params as [
      string,
      string,
      string,
      string,
      string,
    ];
    const row: AccountRow = {
      id: randomUUID(),
      user_id: userId,
      account_number: accountNumber,
      currency,
      cached_balance: cachedBalance,
      status,
    };
    this.accounts.push(row);
    return { rows: [row] };
  }

  private updateProfile(params: unknown[]): QueryResult<UserRow> {
    const [fullName, email, phoneNumber, id] = params as [string | null, string | null, string | null, string];
    const user = this.users.find((candidate) => candidate.id === id);

    if (!user) {
      return { rows: [] };
    }

    if (email && this.users.some((candidate) => candidate.id !== id && candidate.email === email)) {
      throw uniqueViolation();
    }

    user.full_name = fullName ?? user.full_name;
    user.email = email ?? user.email;
    user.phone_number = phoneNumber ?? user.phone_number;
    return { rows: [user] };
  }

  private updateStatus(params: unknown[]): QueryResult<UserRow> {
    const [status, id] = params as [string, string];
    const user = this.users.find((candidate) => candidate.id === id);

    if (!user) {
      return { rows: [] };
    }

    user.status = status;
    return { rows: [user] };
  }

  /** Utilitário de teste: acesso direto às contas criadas, para asserts adicionais. */
  getAccountsByUserId(userId: string): AccountRow[] {
    return this.accounts.filter((account) => account.user_id === userId);
  }
}
