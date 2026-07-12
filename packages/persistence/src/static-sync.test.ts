import { describe, expect, it } from 'vitest';
import type { Airport } from '@hangban/contracts';
import type { GeoCityRecord } from '@hangban/adapters';

import { createAirportKey, syncStaticData } from './static-sync';

const airport: Airport = {
  iata: 'SZX',
  icao: 'ZGSZ',
  name: "Shenzhen Bao'an International Airport",
  city: 'Shenzhen',
  country: 'CN',
  latitude: 22.639474,
  longitude: 113.803262,
  elevationM: 4,
  type: 'large_airport',
};
const city: GeoCityRecord = {
  geonamesId: 1795565,
  name: 'Shenzhen',
  asciiName: 'Shenzhen',
  localizedName: '深圳',
  aliases: ['Shenzhen', '深圳'],
  country: 'CN',
  latitude: 22.54554,
  longitude: 114.0683,
  population: 17_494_398,
};

describe('static data synchronization', () => {
  it('creates stable airport keys with code priority', () => {
    expect(createAirportKey(airport)).toBe('icao:ZGSZ');
    expect(createAirportKey({ ...airport, icao: undefined })).toBe('iata:SZX');
    expect(createAirportKey({ ...airport, icao: undefined, iata: undefined })).toMatch(/^geo:/);
  });

  it('rejects empty source datasets before opening a transaction', async () => {
    const pool = { connect: () => Promise.reject(new Error('must not connect')) };
    await expect(
      syncStaticData(pool, { airports: [], cities: [city], sourceVersion: 'test' }),
    ).rejects.toThrow('STATIC_SYNC_EMPTY_DATASET');
  });

  it('rolls back and preserves the previous version when alias insertion fails', async () => {
    const commands: string[] = [];
    const client = {
      async query(sql: string) {
        commands.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
        if (sql.includes('INSERT INTO temp_city_aliases')) throw new Error('fixture failure');
        return { rows: [] };
      },
      release() {},
    };
    await expect(
      syncStaticData(
        { connect: async () => client },
        { airports: [airport], cities: [city], sourceVersion: 'test' },
      ),
    ).rejects.toThrow('STATIC_SYNC_FAILED');
    expect(commands).toContain('ROLLBACK');
    expect(commands).not.toContain('COMMIT');
  });
});
