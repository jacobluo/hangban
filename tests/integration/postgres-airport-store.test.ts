import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPostgresPool, PostgresAirportStore } from '../../packages/persistence/src/index';

const connectionString = process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase('PostgresAirportStore', () => {
  const pool = createPostgresPool({ connectionString: connectionString! });
  const store = new PostgresAirportStore(pool);

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });
  afterAll(async () => {
    await pool.end();
  });

  for (const query of ['深圳', 'shenzhen', 'SZX', 'ZGSZ']) {
    it(`finds SZX by ${query}`, async () => {
      expect((await store.search(query, 20))[0]?.airport.iata).toBe('SZX');
    });
  }

  it('finds Hongqiao by its English airport name', async () => {
    expect((await store.search('Hongqiao', 20))[0]?.airport.iata).toBe('SHA');
  });

  it('returns only airports inside the requested viewport', async () => {
    const result = await store.queryViewport({ bbox: [113, 22, 114, 23], zoom: 8, limit: 20 });
    expect(result.airports).toEqual(
      expect.arrayContaining([expect.objectContaining({ iata: 'SZX' })]),
    );
    expect(
      result.airports.every((airport) => airport.longitude >= 113 && airport.longitude <= 114),
    ).toBe(true);
  });
});
