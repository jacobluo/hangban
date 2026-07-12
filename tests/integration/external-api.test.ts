import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../packages/config/src/index';
import { createExternalApiRuntime } from '../../apps/api/src/external-runtime';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const describeExternal = databaseUrl && redisUrl ? describe : describe.skip;

describeExternal('external API runtime', () => {
  let runtime: Awaited<ReturnType<typeof createExternalApiRuntime>>;

  beforeAll(async () => {
    runtime = await createExternalApiRuntime(
      loadConfig({
        DATA_MODE: 'live',
        LIVE_PROVIDERS: 'adsb-lol',
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        REDIS_KEY_PREFIX: `hangban-test-api:${process.pid}`,
      }),
      { logger: false },
    );
  });
  afterAll(async () => runtime.app.close());

  it('reports ready when PostgreSQL migrations and Redis are available', async () => {
    expect((await runtime.app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('searches the PostgreSQL airport catalog', async () => {
    const response = await runtime.app.inject({ method: 'GET', url: '/api/v1/search?q=Hongqiao' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ airports: [{ iata: 'SHA' }] });
  });
});
