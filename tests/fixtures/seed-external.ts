import type { GeoCityRecord } from '../../packages/adapters/src/index';
import type { Airport } from '../../packages/contracts/src/index';
import {
  airports as demoAirports,
  createDemoFlights,
  createDemoSourceStatuses,
} from '../../packages/testkit/src/index';
import { createPostgresPool, syncStaticData } from '../../packages/persistence/src/index';
import { createRedisConnections, RedisFlightStore } from '../../packages/realtime-store/src/index';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error('EXTERNAL_STORES_REQUIRED');

const countries: Record<string, string> = {
  中国: 'CN',
  日本: 'JP',
  新加坡: 'SG',
  美国: 'US',
};
const airports: Airport[] = [
  ...demoAirports.map((airport) => ({
    ...airport,
    country: countries[airport.country] ?? airport.country,
  })),
  {
    iata: 'SHA',
    icao: 'ZSSS',
    name: 'Shanghai Hongqiao International Airport',
    city: 'Shanghai',
    localizedCity: '上海',
    country: 'CN',
    latitude: 31.1979,
    longitude: 121.3363,
    elevationM: 3,
    type: 'large_airport',
  },
];
const cities: GeoCityRecord[] = airports.map((airport, index) => ({
  geonamesId: index + 1,
  name: airport.city,
  asciiName: airport.city,
  ...(airport.localizedCity ? { localizedName: airport.localizedCity } : {}),
  aliases: [...new Set([airport.city, airport.localizedCity ?? airport.city])],
  country: airport.country,
  latitude: airport.latitude,
  longitude: airport.longitude,
  population: 1_000_000,
}));

async function main() {
  const pool = createPostgresPool({ connectionString: databaseUrl! });
  const redis = createRedisConnections(redisUrl!);
  try {
    await syncStaticData(pool, { airports, cities, sourceVersion: 'e2e-fixture-v1' });
    await redis.connect();
    const now = new Date('2026-07-12T08:00:00.000Z');
    await new RedisFlightStore(redis.command, {
      prefix: process.env.REDIS_KEY_PREFIX ?? 'hangban',
      ttlMs: 3_600_000,
    }).commitCycle({
      flights: createDemoFlights(now),
      statuses: createDemoSourceStatuses(now),
      observedAt: now.toISOString(),
    });
    process.stdout.write(`${JSON.stringify({ event: 'external-fixture.seeded' })}\n`);
  } finally {
    await Promise.allSettled([pool.end(), redis.close()]);
  }
}

void main().catch(() => {
  process.exitCode = 1;
  process.stderr.write(`${JSON.stringify({ event: 'external-fixture.failed' })}\n`);
});
