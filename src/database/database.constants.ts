/**
 * Token usado para injetar o Pool de conexões do 'pg' em qualquer service/repository.
 * Uso: constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
 */
export const PG_POOL = 'PG_POOL';
