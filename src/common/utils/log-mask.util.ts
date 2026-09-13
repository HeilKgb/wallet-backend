/** Mascara um CPF para log/auditoria: "12345678901" -> "123.***.**8-01" (mantém só o suficiente pra correlacionar, não pra identificar). */
export function maskCpf(cpf: string | null | undefined): string {
  if (!cpf || cpf.length !== 11) return '***';
  return `${cpf.slice(0, 3)}.***.**${cpf.slice(8, 9)}-${cpf.slice(9)}`;
}

/** Mascara um email para log: "ana.silva@example.com" -> "an***@example.com". */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/** Mascara um número de conta, mostrando só os últimos 4 dígitos. */
export function maskAccountNumber(accountNumber: string | null | undefined): string {
  if (!accountNumber || accountNumber.length <= 4) return '***';
  return `${'*'.repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`;
}
