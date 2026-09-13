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

interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  status: string;
  expires_at: Date;
}

interface TransactionRow {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  description: string | null;
  origin_account_id: string | null;
  destination_account_id: string | null;
  reversal_of_id: string | null;
  idempotency_key: string | null;
  initiated_by_id: string;
  created_at: Date;
  completed_at: Date | null;
}

interface QueryResult<T> {
  rows: T[];
  rowCount?: number;
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
  private refreshTokens: RefreshTokenRow[] = [];
  private transactions: TransactionRow[] = [];
  private snapshot: {
    users: UserRow[];
    accounts: AccountRow[];
    refreshTokens: RefreshTokenRow[];
    transactions: TransactionRow[];
  } | null = null;

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
  end(): Promise<void> {
    this.snapshot = null;
    this.users = [];
    this.accounts = [];
    this.refreshTokens = [];
    this.transactions = [];
    return Promise.resolve();
  }

  private async execute<T>(text: string, params: unknown[]): Promise<QueryResult<T>> {
    const sql = text.trim();
    const result =
      this.handleTransactionControl<T>(sql) ??
      this.handleInsertStatements<T>(sql, params) ??
      this.handleUserStatements<T>(sql, params) ??
      this.handleRefreshTokenStatements<T>(sql, params) ??
      this.handleAccountStatements<T>(sql, params) ??
      this.handleTransactionStatements<T>(sql, params);

    if (result) {
      return result;
    }

    throw new Error(`FakePgPool: query não suportada: ${sql}`);
  }

  private handleTransactionControl<T>(sql: string): QueryResult<T> | null {
    if (sql.startsWith('BEGIN')) {
      this.snapshot = {
        users: this.users.map((user) => ({ ...user, created_at: new Date(user.created_at) })),
        accounts: this.accounts.map((account) => ({ ...account })),
        refreshTokens: this.refreshTokens.map((token) => ({ ...token, expires_at: new Date(token.expires_at) })),
        transactions: this.transactions.map((transaction) => ({
          ...transaction,
          created_at: new Date(transaction.created_at),
          completed_at: transaction.completed_at ? new Date(transaction.completed_at) : null,
        })),
      };
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
        this.refreshTokens = this.snapshot.refreshTokens;
        this.transactions = this.snapshot.transactions;
        this.snapshot = null;
      }
      return { rows: [] as T[] };
    }

    return null;
  }

  private handleInsertStatements<T>(sql: string, params: unknown[]): QueryResult<T> | null {
    if (sql.startsWith('INSERT INTO users')) {
      return this.insertUser(params) as QueryResult<T>;
    }

    if (sql.startsWith('INSERT INTO accounts')) {
      return this.insertAccount(params) as QueryResult<T>;
    }

    if (sql.startsWith('INSERT INTO refresh_tokens')) {
      return this.insertRefreshToken(params) as QueryResult<T>;
    }

    if (sql.startsWith('INSERT INTO transactions') && sql.includes('reversal_of_id, idempotency_key')) {
      return this.insertTransaction(params, 'reversal_of_id') as QueryResult<T>;
    }

    if (sql.startsWith('INSERT INTO transactions') && sql.includes('idempotency_key')) {
      return this.insertTransaction(params, 'idempotency_key') as QueryResult<T>;
    }

    return null;
  }

  private handleUserStatements<T>(sql: string, params: unknown[]): QueryResult<T> | null {
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

    return null;
  }

  private handleRefreshTokenStatements<T>(sql: string, params: unknown[]): QueryResult<T> | null {
    if (sql.includes('FROM refresh_tokens rt') && sql.includes('JOIN users u')) {
      const [tokenHash] = params as [string];
      const row = this.refreshTokens.find((token) => token.token_hash === tokenHash);
      const user = row && this.users.find((candidate) => candidate.id === row.user_id);
      if (!row || !user) {
        return { rows: [] as T[] };
      }

      return {
        rows: [
          {
            id: row.id,
            user_id: row.user_id,
            family_id: row.family_id,
            status: row.status,
            expires_at: row.expires_at,
            email: user.email,
          },
        ] as T[],
      };
    }

    if (sql.startsWith('SELECT family_id FROM refresh_tokens')) {
      const [tokenHash] = params as [string];
      const row = this.refreshTokens.find((token) => token.token_hash === tokenHash);
      return { rows: (row ? [{ family_id: row.family_id }] : []) as T[] };
    }

    if (sql.startsWith("UPDATE refresh_tokens SET status = 'ROTATED'")) {
      const [id] = params as [string];
      const row = this.refreshTokens.find((token) => token.id === id);
      if (row) {
        row.status = 'ROTATED';
      }
      return { rows: [] as T[] };
    }

    if (sql.startsWith("UPDATE refresh_tokens SET status = 'REVOKED'")) {
      const [familyId] = params as [string];
      this.refreshTokens
        .filter((token) => token.family_id === familyId && token.status !== 'REVOKED')
        .forEach((token) => {
          token.status = 'REVOKED';
        });
      return { rows: [] as T[] };
    }

    return null;
  }

  private handleAccountStatements<T>(sql: string, params: unknown[]): QueryResult<T> | null {
    if (sql.includes('FROM accounts') && sql.includes('WHERE user_id = $1 AND status = $2')) {
      const [ownerUserId, status] = params as [string, string];
      const found = this.accounts.find((account) => account.user_id === ownerUserId && account.status === status);
      return { rows: (found ? [found] : []) as T[] };
    }

    if (sql.includes('FROM accounts') && sql.includes('WHERE account_number = $1 AND status = $2')) {
      const [accountNumber, status] = params as [string, string];
      const found = this.accounts.find((account) => account.account_number === accountNumber && account.status === status);
      return { rows: (found ? [found] : []) as T[] };
    }

    if (sql.includes('FROM accounts a') && sql.includes('JOIN users u') && sql.includes('WHERE u.cpf = $1 AND a.status = $2')) {
      const [cpf, status] = params as [string, string];
      const user = this.users.find((candidate) => candidate.cpf === cpf);
      const found = user && this.accounts.find((account) => account.user_id === user.id && account.status === status);
      return { rows: (found ? [found] : []) as T[] };
    }

    if (sql.startsWith('UPDATE accounts') && sql.includes('cached_balance - $1')) {
      const [amount, accountId] = params as [string, string];
      const account = this.accounts.find((candidate) => candidate.id === accountId);
      if (!account || this.toCents(account.cached_balance) < this.toCents(amount)) {
        return { rows: [] as T[], rowCount: 0 };
      }
      account.cached_balance = this.fromCents(this.toCents(account.cached_balance) - this.toCents(amount));
      return { rows: [] as T[], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE accounts') && sql.includes('cached_balance + $1')) {
      const [amount, accountId] = params as [string, string];
      const account = this.accounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        return { rows: [] as T[], rowCount: 0 };
      }
      account.cached_balance = this.fromCents(this.toCents(account.cached_balance) + this.toCents(amount));
      return { rows: [] as T[], rowCount: 1 };
    }

    return null;
  }

  private handleTransactionStatements<T>(sql: string, params: unknown[]): QueryResult<T> | null {
    if (sql.includes('FROM transactions') && sql.includes('WHERE idempotency_key = $1 AND origin_account_id = $2')) {
      const [idempotencyKey, originAccountId] = params as [string, string];
      const found = this.transactions.find(
        (transaction) => transaction.idempotency_key === idempotencyKey && transaction.origin_account_id === originAccountId,
      );
      return { rows: (found ? [found] : []) as T[] };
    }

    if (sql.startsWith('SELECT id, type, status') && sql.includes('ORDER BY created_at DESC')) {
      const rows = [...this.transactions].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return { rows: rows as T[] };
    }

    if (sql.includes('FROM transactions t') && sql.includes('JOIN accounts origin')) {
      const [transactionId, ownerUserId] = params as [string, string];
      const found = this.transactions.find((transaction) => {
        if (transaction.id !== transactionId) return false;
        const origin = this.accounts.find((account) => account.id === transaction.origin_account_id);
        return origin?.user_id === ownerUserId;
      });
      return { rows: (found ? [found] : []) as T[] };
    }

    if (sql.startsWith('SELECT id FROM transactions WHERE reversal_of_id')) {
      const [transactionId] = params as [string];
      const found = this.transactions.find((transaction) => transaction.reversal_of_id === transactionId);
      return { rows: (found ? [{ id: found.id }] : []) as T[] };
    }

    if (sql.startsWith('UPDATE transactions') && sql.includes('SET status = $1')) {
      const [status, id] = params as [string, string];
      const transaction = this.transactions.find((candidate) => candidate.id === id);
      if (transaction) {
        transaction.status = status;
        transaction.completed_at = transaction.completed_at ?? new Date();
      }
      return { rows: [] as T[] };
    }

    if (sql.startsWith('SELECT id, type, status') && sql.includes('WHERE id = $1')) {
      const [id] = params as [string];
      const found = this.transactions.find((transaction) => transaction.id === id);
      return { rows: (found ? [found] : []) as T[] };
    }

    return null;
  }

  private toCents(amount: string): number {
    return Math.round(Number.parseFloat(amount) * 100);
  }

  private fromCents(cents: number): string {
    return (cents / 100).toFixed(2);
  }

  private insertTransaction(params: unknown[], mode: 'idempotency_key' | 'reversal_of_id'): QueryResult<TransactionRow> {
    const [type, status, amount, currency, descriptionOrReason, originAccountId, destinationAccountId, extra, initiatedById] =
      params as [string, string, string, string, string | null, string, string, string | null, string];
    const row: TransactionRow = {
      id: randomUUID(),
      type,
      status,
      amount,
      currency,
      description: descriptionOrReason,
      origin_account_id: originAccountId,
      destination_account_id: destinationAccountId,
      reversal_of_id: mode === 'reversal_of_id' ? extra : null,
      idempotency_key: mode === 'idempotency_key' ? extra : null,
      initiated_by_id: initiatedById,
      created_at: new Date(),
      completed_at: new Date(),
    };
    this.transactions.push(row);
    return { rows: [row] };
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

  private insertRefreshToken(params: unknown[]): QueryResult<RefreshTokenRow> {
    const [userId, familyId, tokenHash, status, expiresAt] = params as [string, string, string, string, Date];
    const row: RefreshTokenRow = {
      id: randomUUID(),
      user_id: userId,
      family_id: familyId,
      token_hash: tokenHash,
      status,
      expires_at: expiresAt,
    };
    this.refreshTokens.push(row);
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

  /** Utilitário de teste: define o saldo de uma conta diretamente, sem passar por depósito real. */
  fundAccount(userId: string, balance: string): void {
    const account = this.accounts.find((candidate) => candidate.user_id === userId);
    if (account) {
      account.cached_balance = balance;
    }
  }
}
