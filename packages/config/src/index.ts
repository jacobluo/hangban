import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bboxSchema, type Bbox } from '@hangban/contracts';
import { z } from 'zod';

const liveProviderSchema = z.enum(['adsb-lol', 'airplanes-live', 'opensky']);

export type LiveProviderId = z.infer<typeof liveProviderSchema>;

const optionalNonemptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATA_MODE: z.enum(['demo', 'live']).default('demo'),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:3000'),
  DATABASE_URL: optionalNonemptyString,
  REDIS_URL: optionalNonemptyString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  REDIS_KEY_PREFIX: z
    .string()
    .trim()
    .regex(/^[a-z0-9:_-]+$/i)
    .default('hangban'),
  LIVE_PROVIDERS: z.string().optional(),
  LIVE_DEFAULT_BBOXES: z.string().default(''),
  INGEST_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  INGESTOR_LEASE_TTL_MS: z.coerce.number().int().min(15_000).default(30_000),
  INGESTOR_LEASE_RENEW_MS: z.coerce.number().int().min(5_000).default(10_000),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  PROVIDER_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
  WEATHER_RADAR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  RAINVIEWER_BASE_URL: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'https:')
    .default('https://api.rainviewer.com'),
  WEATHER_RADAR_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  WEATHER_RADAR_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(86_400_000)
    .default(86_400_000),
  WEATHER_RADAR_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(2_048),
  WEATHER_RADAR_CACHE_MAX_BYTES: z.coerce.number().int().positive().default(134_217_728),
  WEATHER_RADAR_MAX_ZOOM: z.coerce.number().int().min(0).max(7).default(7),
  ADSB_LOL_BASE_URL: z.url().default('https://api.adsb.lol/v2'),
  AIRPLANES_LIVE_BASE_URL: z.url().default('https://api.airplanes.live/v2'),
  OPENSKY_BASE_URL: z.url().default('https://opensky-network.org/api'),
  OPENSKY_TOKEN_URL: z
    .url()
    .default(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    ),
  OPENSKY_CLIENT_ID: optionalNonemptyString,
  OPENSKY_CLIENT_SECRET: optionalNonemptyString,
  AIRPORTS_DATA_PATH: z.string().trim().min(1).default('data/airports.json'),
  OURAIRPORTS_CSV_URL: z
    .url()
    .default('https://davidmegginson.github.io/ourairports-data/airports.csv'),
  GEONAMES_CITIES_URL: z.url().default('https://download.geonames.org/export/dump/cities500.zip'),
  GEONAMES_ALTERNATE_NAMES_URL: z
    .url()
    .default('https://download.geonames.org/export/dump/alternateNamesV2.zip'),
  GEONAMES_DATA_PATH: z.string().trim().min(1).default('data/cities.json'),
  GEONAMES_SYNC_TIMEOUT_MS: z.coerce.number().int().positive().default(14_400_000),
  ADSBDB_BASE_URL: z.url().default('https://api.adsbdb.com/v0'),
  ADSBDB_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  ADSBDB_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  ADSBDB_AIRCRAFT_CACHE_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
  ADSBDB_ROUTE_CACHE_TTL_MS: z.coerce.number().int().positive().default(21_600_000),
  ADSBDB_NEGATIVE_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
});

export type RuntimeConfig = {
  nodeEnv: z.infer<typeof configSchema>['NODE_ENV'];
  apiHost: string;
  apiPort: number;
  dataMode: z.infer<typeof configSchema>['DATA_MODE'];
  webOrigin: string;
  databaseUrl?: string;
  redisUrl?: string;
  databasePoolMax: number;
  redisKeyPrefix: string;
  liveProviders: LiveProviderId[];
  liveDefaultBboxes: Bbox[];
  ingestIntervalMs: number;
  ingestorLeaseTtlMs: number;
  ingestorLeaseRenewMs: number;
  providerTimeoutMs: number;
  providerCacheTtlMs: number;
  weatherRadarEnabled: boolean;
  rainViewerBaseUrl: string;
  weatherRadarTimeoutMs: number;
  weatherRadarCacheTtlMs: number;
  weatherRadarCacheMaxEntries: number;
  weatherRadarCacheMaxBytes: number;
  weatherRadarMaxZoom: number;
  adsbLolBaseUrl: string;
  airplanesLiveBaseUrl: string;
  openSkyBaseUrl: string;
  openSkyTokenUrl: string;
  openSkyClientId?: string;
  openSkyClientSecret?: string;
  airportsDataPath: string;
  ourAirportsCsvUrl: string;
  geonamesCitiesUrl: string;
  geonamesAlternateNamesUrl: string;
  geonamesDataPath: string;
  geonamesSyncTimeoutMs: number;
  adsbdbBaseUrl: string;
  adsbdbConcurrency: number;
  adsbdbTimeoutMs: number;
  adsbdbAircraftCacheTtlMs: number;
  adsbdbRouteCacheTtlMs: number;
  adsbdbNegativeCacheTtlMs: number;
};

function parseLiveProviders(value: string | undefined): LiveProviderId[] {
  const tokens = (value === undefined ? ['adsb-lol'] : value.split(','))
    .map((token) => token.trim())
    .filter(Boolean);
  return [...new Set(tokens)].map((token) => liveProviderSchema.parse(token));
}

function parseBboxes(value: string): Bbox[] {
  if (value.trim() === '') return [];
  return value.split(';').map((encodedBbox) => {
    const coordinates = encodedBbox.split(',').map((coordinate) => coordinate.trim());
    if (coordinates.length !== 4 || coordinates.some((coordinate) => coordinate === '')) {
      throw new Error('Each LIVE_DEFAULT_BBOXES entry must contain four coordinates');
    }
    return bboxSchema.parse(coordinates.map(Number));
  });
}

const defaultApplicationBaseDir = fileURLToPath(new URL('../../../', import.meta.url));

export function loadConfig(
  environment: Record<string, string | undefined>,
  options: { baseDir?: string } = {},
): RuntimeConfig {
  const parsed = configSchema.parse(environment);
  const liveProviders = parseLiveProviders(parsed.LIVE_PROVIDERS);

  if (parsed.DATA_MODE === 'live' && liveProviders.length === 0) {
    throw new Error('LIVE_PROVIDERS must contain at least one provider in live mode');
  }
  if (parsed.DATA_MODE === 'live' && (!parsed.DATABASE_URL || !parsed.REDIS_URL)) {
    throw new Error('DATABASE_URL and REDIS_URL are required in live mode');
  }
  if (Boolean(parsed.OPENSKY_CLIENT_ID) !== Boolean(parsed.OPENSKY_CLIENT_SECRET)) {
    throw new Error('OpenSky client ID and client secret must be configured together');
  }
  if (parsed.INGESTOR_LEASE_RENEW_MS > parsed.INGESTOR_LEASE_TTL_MS / 2) {
    throw new Error('INGESTOR_LEASE_RENEW_MS must not exceed half of INGESTOR_LEASE_TTL_MS');
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    apiHost: parsed.API_HOST,
    apiPort: parsed.API_PORT,
    dataMode: parsed.DATA_MODE,
    webOrigin: parsed.WEB_ORIGIN,
    ...(parsed.DATABASE_URL ? { databaseUrl: parsed.DATABASE_URL } : {}),
    ...(parsed.REDIS_URL ? { redisUrl: parsed.REDIS_URL } : {}),
    databasePoolMax: parsed.DATABASE_POOL_MAX,
    redisKeyPrefix: parsed.REDIS_KEY_PREFIX,
    liveProviders,
    liveDefaultBboxes: parseBboxes(parsed.LIVE_DEFAULT_BBOXES),
    ingestIntervalMs: parsed.INGEST_INTERVAL_MS,
    ingestorLeaseTtlMs: parsed.INGESTOR_LEASE_TTL_MS,
    ingestorLeaseRenewMs: parsed.INGESTOR_LEASE_RENEW_MS,
    providerTimeoutMs: parsed.PROVIDER_TIMEOUT_MS,
    providerCacheTtlMs: parsed.PROVIDER_CACHE_TTL_MS,
    weatherRadarEnabled: parsed.WEATHER_RADAR_ENABLED,
    rainViewerBaseUrl: parsed.RAINVIEWER_BASE_URL,
    weatherRadarTimeoutMs: parsed.WEATHER_RADAR_TIMEOUT_MS,
    weatherRadarCacheTtlMs: parsed.WEATHER_RADAR_CACHE_TTL_MS,
    weatherRadarCacheMaxEntries: parsed.WEATHER_RADAR_CACHE_MAX_ENTRIES,
    weatherRadarCacheMaxBytes: parsed.WEATHER_RADAR_CACHE_MAX_BYTES,
    weatherRadarMaxZoom: parsed.WEATHER_RADAR_MAX_ZOOM,
    adsbLolBaseUrl: parsed.ADSB_LOL_BASE_URL,
    airplanesLiveBaseUrl: parsed.AIRPLANES_LIVE_BASE_URL,
    openSkyBaseUrl: parsed.OPENSKY_BASE_URL,
    openSkyTokenUrl: parsed.OPENSKY_TOKEN_URL,
    ...(parsed.OPENSKY_CLIENT_ID === undefined
      ? {}
      : {
          openSkyClientId: parsed.OPENSKY_CLIENT_ID,
          openSkyClientSecret: parsed.OPENSKY_CLIENT_SECRET!,
        }),
    airportsDataPath: isAbsolute(parsed.AIRPORTS_DATA_PATH)
      ? parsed.AIRPORTS_DATA_PATH
      : resolve(options.baseDir ?? defaultApplicationBaseDir, parsed.AIRPORTS_DATA_PATH),
    ourAirportsCsvUrl: parsed.OURAIRPORTS_CSV_URL,
    geonamesCitiesUrl: parsed.GEONAMES_CITIES_URL,
    geonamesAlternateNamesUrl: parsed.GEONAMES_ALTERNATE_NAMES_URL,
    geonamesDataPath: isAbsolute(parsed.GEONAMES_DATA_PATH)
      ? parsed.GEONAMES_DATA_PATH
      : resolve(options.baseDir ?? defaultApplicationBaseDir, parsed.GEONAMES_DATA_PATH),
    geonamesSyncTimeoutMs: parsed.GEONAMES_SYNC_TIMEOUT_MS,
    adsbdbBaseUrl: parsed.ADSBDB_BASE_URL,
    adsbdbConcurrency: parsed.ADSBDB_CONCURRENCY,
    adsbdbTimeoutMs: parsed.ADSBDB_TIMEOUT_MS,
    adsbdbAircraftCacheTtlMs: parsed.ADSBDB_AIRCRAFT_CACHE_TTL_MS,
    adsbdbRouteCacheTtlMs: parsed.ADSBDB_ROUTE_CACHE_TTL_MS,
    adsbdbNegativeCacheTtlMs: parsed.ADSBDB_NEGATIVE_CACHE_TTL_MS,
  };
}
