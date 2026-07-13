import type { FastifyBaseLogger } from 'fastify';

import type { RuntimeConfig } from '@hangban/config';
import type { Bbox, SourceStatus } from '@hangban/contracts';
import { checkPostgres, createPostgresPool, PostgresAirportStore } from '@hangban/persistence';
import {
  checkRedis,
  createRedisConnections,
  RedisFlightStore,
  subscribeChanges,
} from '@hangban/realtime-store';

import { buildApp, createConfiguredWeatherRadarService } from './app';
import { createMemoryRepository } from './memory-repository';

const WORLD: Bbox = [-180, -90, 180, 90];

const within = async (operation: Promise<unknown>, milliseconds: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('READINESS_TIMEOUT')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export async function createExternalApiRuntime(
  config: RuntimeConfig,
  { logger = true }: { logger?: boolean | FastifyBaseLogger } = {},
) {
  if (config.dataMode !== 'live' || !config.databaseUrl || !config.redisUrl) {
    throw new Error('EXTERNAL_STORES_REQUIRED');
  }
  const weatherRadarService = createConfiguredWeatherRadarService(config);
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
  });
  const connections = createRedisConnections(config.redisUrl);
  try {
    await Promise.all([checkPostgres(pool), connections.connect()]);
    const airportStore = new PostgresAirportStore(pool);
    const flightStore = new RedisFlightStore(connections.command, {
      prefix: config.redisKeyPrefix,
    });
    const [flights, statuses] = await Promise.all([
      flightStore.snapshotByBbox(WORLD),
      flightStore.sourceStatuses(),
    ]);
    const repository = createMemoryRepository({ airports: [], flights, sourceStatuses: statuses });
    const unsubscribe = await subscribeChanges(connections.subscriber, {
      prefix: config.redisKeyPrefix,
      onEvent: (event) => {
        if (event.type === 'flight.upsert') {
          const next = repository.allFlights().filter(({ id }) => id !== event.flight.id);
          repository.replaceFlights([...next, event.flight]);
        } else if (event.type === 'flight.remove') {
          repository.replaceFlights(
            repository.allFlights().filter(({ id }) => id !== event.flightId),
          );
        } else {
          const byProvider = new Map<string, SourceStatus>(
            repository.sourceStatuses().map((status) => [status.providerId, status]),
          );
          byProvider.set(event.status.providerId, event.status);
          repository.replaceSourceStatuses([...byProvider.values()]);
        }
      },
    });
    const readiness = async () => {
      await within(
        Promise.all([
          checkPostgres(pool),
          pool.query('SELECT 1 FROM schema_migrations LIMIT 1'),
          checkRedis(connections.command),
        ]),
        2_000,
      );
      return true;
    };
    const app = buildApp({
      repository,
      airportStore,
      readiness,
      realtimeAvailable: () => connections.command.isReady,
      logger,
      webOrigin: config.webOrigin,
      weatherRadarService,
    });
    app.addHook('onClose', async () => {
      await unsubscribe();
      await Promise.all([pool.end(), connections.close()]);
    });
    return { app, repository, airportStore, flightStore };
  } catch (error) {
    weatherRadarService.clear();
    await Promise.allSettled([pool.end(), connections.close()]);
    throw error;
  }
}
