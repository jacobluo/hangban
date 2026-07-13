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
import type { WeatherRadarService } from './weather-radar-service';

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
  let weatherRadarService: WeatherRadarService | undefined;
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let connections: ReturnType<typeof createRedisConnections> | undefined;
  try {
    weatherRadarService = createConfiguredWeatherRadarService(config);
    const activeWeatherRadarService = weatherRadarService;
    pool = createPostgresPool({
      connectionString: config.databaseUrl,
      max: config.databasePoolMax,
    });
    const activePool = pool;
    connections = createRedisConnections(config.redisUrl);
    const activeConnections = connections;
    await Promise.all([checkPostgres(activePool), activeConnections.connect()]);
    const airportStore = new PostgresAirportStore(activePool);
    const flightStore = new RedisFlightStore(activeConnections.command, {
      prefix: config.redisKeyPrefix,
    });
    const [flights, statuses] = await Promise.all([
      flightStore.snapshotByBbox(WORLD),
      flightStore.sourceStatuses(),
    ]);
    const repository = createMemoryRepository({ airports: [], flights, sourceStatuses: statuses });
    const unsubscribe = await subscribeChanges(activeConnections.subscriber, {
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
          checkPostgres(activePool),
          activePool.query('SELECT 1 FROM schema_migrations LIMIT 1'),
          checkRedis(activeConnections.command),
        ]),
        2_000,
      );
      return true;
    };
    const app = buildApp({
      repository,
      airportStore,
      readiness,
      realtimeAvailable: () => activeConnections.command.isReady,
      logger,
      webOrigin: config.webOrigin,
      weatherRadarService: activeWeatherRadarService,
    });
    app.addHook('onClose', async () => {
      await unsubscribe();
      await Promise.all([activePool.end(), activeConnections.close()]);
    });
    return { app, repository, airportStore, flightStore };
  } catch (error) {
    weatherRadarService?.clear();
    const cleanup: Promise<unknown>[] = [];
    if (pool) cleanup.push(pool.end());
    if (connections) cleanup.push(connections.close());
    await Promise.allSettled(cleanup);
    throw error;
  }
}
