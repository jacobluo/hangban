import Fastify, { type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';

import { createRainViewerProvider, type FlightPositionProvider } from '@hangban/adapters';
import type { RuntimeConfig } from '@hangban/config';
import type { Airport } from '@hangban/contracts';
import type { ProviderScheduler } from '@hangban/ingestion';
import { createDemoFlights, createDemoSourceStatuses } from '@hangban/testkit';

import { advanceDemoFlights } from './demo-motion';
import { createAirportIndex } from './airport-index';
import type { GeoCityRecord } from '@hangban/adapters';
import type { LiveIngestionController } from './live-ingestion';
import { createMemoryRepository } from './memory-repository';
import type { FlightRepository } from './repository';
import { createRealtimeHub, type RealtimeHub } from './realtime/hub';
import { registerRealtimeSocket } from './realtime/socket';
import { registerAirportRoutes } from './routes/airports';
import { registerFlightRoutes } from './routes/flights';
import { registerMapRoutes } from './routes/map';
import { registerRouteRoutes } from './routes/routes';
import { registerSearchRoutes } from './routes/search';
import { registerStatusRoutes } from './routes/status';
import { registerWeatherRadarRoutes } from './routes/weather-radar';
import type { AirportStore } from './airport-store';
import { createWeatherRadarCache } from './weather-radar-cache';
import {
  createDisabledWeatherRadarService,
  createWeatherRadarService,
  type WeatherRadarService,
} from './weather-radar-service';

const MAX_WEATHER_RADAR_TILE_BYTES = 1_048_576;

type BuildAppOptions = {
  repository: FlightRepository;
  now?: () => Date;
  logger?: boolean | FastifyBaseLogger;
  webOrigin?: string;
  hub?: RealtimeHub;
  realtimePushIntervalMs?: number;
  airportStore?: AirportStore;
  readiness?: () => Promise<boolean>;
  realtimeAvailable?: () => boolean;
  weatherRadarService?: WeatherRadarService;
};

export function buildApp({
  repository,
  now = () => new Date(),
  logger = true,
  webOrigin = 'http://127.0.0.1:3000',
  hub = createRealtimeHub(),
  realtimePushIntervalMs = 10_000,
  airportStore = repository.airportIndex(),
  readiness,
  realtimeAvailable,
  weatherRadarService = createDisabledWeatherRadarService(),
}: BuildAppOptions) {
  const app = Fastify({ logger });
  app.register(cors, { origin: webOrigin });
  void registerMapRoutes(app, repository, now, realtimeAvailable);
  void registerSearchRoutes(app, repository, airportStore);
  void registerFlightRoutes(app, repository);
  void registerAirportRoutes(app, repository, airportStore);
  void registerRouteRoutes(app, repository, now, airportStore);
  void registerStatusRoutes(app, repository, readiness);
  void registerWeatherRadarRoutes(app, weatherRadarService);
  registerRealtimeSocket(app, repository, hub, now, realtimePushIntervalMs);
  app.addHook('onClose', async () => {
    weatherRadarService.clear();
  });
  return app;
}

export function createConfiguredWeatherRadarService(config: RuntimeConfig): WeatherRadarService {
  if (!config.weatherRadarEnabled) return createDisabledWeatherRadarService();

  const provider = createRainViewerProvider({
    baseUrl: config.rainViewerBaseUrl,
    timeoutMs: config.weatherRadarTimeoutMs,
    maxTileBytes: Math.min(MAX_WEATHER_RADAR_TILE_BYTES, config.weatherRadarCacheMaxBytes),
  });
  const cache = createWeatherRadarCache({
    ttlMs: config.weatherRadarCacheTtlMs,
    maxEntries: config.weatherRadarCacheMaxEntries,
    maxBytes: config.weatherRadarCacheMaxBytes,
  });
  return createWeatherRadarService({
    enabled: true,
    provider,
    cache,
    maxZoom: config.weatherRadarMaxZoom,
  });
}

type CreateApiRuntimeOptions = {
  config: RuntimeConfig;
  airports: Airport[];
  cities?: GeoCityRecord[];
  now?: () => Date;
  logger?: boolean | FastifyBaseLogger;
  providers?: FlightPositionProvider[];
  scheduler?: ProviderScheduler;
};

export function createApiRuntime({
  config,
  airports,
  cities = [],
  now = () => new Date(),
  logger = true,
  providers: injectedProviders,
  scheduler: injectedScheduler,
}: CreateApiRuntimeOptions): {
  app: ReturnType<typeof buildApp>;
  repository: FlightRepository;
  hub: RealtimeHub;
  liveIngestion: LiveIngestionController | null;
} {
  if (config.dataMode === 'live') throw new Error('EXTERNAL_RUNTIME_REQUIRED');
  void injectedProviders;
  void injectedScheduler;
  const startedAt = now();
  const repository = createMemoryRepository({
    airports,
    flights: createDemoFlights(startedAt),
    sourceStatuses: createDemoSourceStatuses(startedAt),
    airportIndex: createAirportIndex(airports, cities),
  });
  const hub = createRealtimeHub();
  const weatherRadarService = createConfiguredWeatherRadarService(config);
  const app = buildApp({
    repository,
    hub,
    now,
    logger,
    webOrigin: config.webOrigin,
    weatherRadarService,
  });

  const liveIngestion: LiveIngestionController | null = null;
  const demoTimer = setInterval(
    () => repository.replaceFlights(advanceDemoFlights(repository.allFlights(), now())),
    10_000,
  );

  app.addHook('onClose', async () => {
    clearInterval(demoTimer);
  });
  return { app, repository, hub, liveIngestion };
}
