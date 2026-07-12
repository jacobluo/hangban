import { loadConfig } from '@hangban/config';
import { createPostgresPool, migrateDatabase } from '@hangban/persistence';

const config = loadConfig(process.env);
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const pool = createPostgresPool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
});
try {
  const result = await migrateDatabase(pool);
  process.stdout.write(`${JSON.stringify({ event: 'database.migrated', ...result })}\n`);
} finally {
  await pool.end();
}
