import { Pool } from 'pg';

export function createPostgresPool({
  connectionString,
  max = 10,
}: {
  connectionString: string;
  max?: number;
}) {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', () => {
    // Request/readiness paths expose stable availability; connection details remain private.
  });
  return pool;
}

export async function checkPostgres(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query('SELECT 1');
}
