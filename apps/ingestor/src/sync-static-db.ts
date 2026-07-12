import { readFile } from 'node:fs/promises';

import { geoCityRecordSchema } from '@hangban/adapters';
import { loadConfig } from '@hangban/config';
import { airportSchema } from '@hangban/contracts';
import { createPostgresPool, syncStaticData } from '@hangban/persistence';

const config = loadConfig(process.env);
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const [airportsRaw, citiesRaw] = await Promise.all([
  readFile(config.airportsDataPath, 'utf8'),
  readFile(config.geonamesDataPath, 'utf8'),
]);
const airports = airportSchema.array().parse(JSON.parse(airportsRaw));
const cities = geoCityRecordSchema.array().parse(JSON.parse(citiesRaw));
const pool = createPostgresPool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
});
try {
  const summary = await syncStaticData(pool, {
    airports,
    cities,
    sourceVersion: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify({ event: 'static-data.synced', ...summary })}\n`);
} finally {
  await pool.end();
}
