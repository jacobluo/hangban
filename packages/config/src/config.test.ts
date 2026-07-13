import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './index';

describe('loadConfig', () => {
  it('loads bounded weather radar defaults', () => {
    expect(loadConfig({})).toMatchObject({
      weatherRadarEnabled: true,
      rainViewerBaseUrl: 'https://api.rainviewer.com',
      weatherRadarTimeoutMs: 8_000,
      weatherRadarCacheTtlMs: 86_400_000,
      weatherRadarCacheMaxEntries: 2_048,
      weatherRadarCacheMaxBytes: 134_217_728,
      weatherRadarMaxZoom: 7,
    });
  });

  it('allows operators to disable the weather radar service explicitly', () => {
    expect(loadConfig({ WEATHER_RADAR_ENABLED: 'false' }).weatherRadarEnabled).toBe(false);
  });

  it('rejects unsafe weather radar limits', () => {
    expect(() => loadConfig({ WEATHER_RADAR_MAX_ZOOM: '8' })).toThrow();
    expect(() => loadConfig({ WEATHER_RADAR_CACHE_TTL_MS: '86400001' })).toThrow();
    expect(() => loadConfig({ WEATHER_RADAR_CACHE_MAX_BYTES: '0' })).toThrow();
    expect(() => loadConfig({ RAINVIEWER_BASE_URL: 'http://example.test' })).toThrow();
  });

  it('defaults to demo mode without provider credentials', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).dataMode).toBe('demo');
  });

  it('requires PostgreSQL and Redis URLs in live mode', () => {
    expect(() => loadConfig({ DATA_MODE: 'live', LIVE_PROVIDERS: 'adsb-lol' })).toThrow(
      'DATABASE_URL and REDIS_URL are required in live mode',
    );
  });

  it('does not require external stores in demo mode', () => {
    const config = loadConfig({ DATA_MODE: 'demo' });
    expect(config).toMatchObject({
      databasePoolMax: 10,
      redisKeyPrefix: 'hangban',
    });
    expect(config).not.toHaveProperty('databaseUrl');
    expect(config).not.toHaveProperty('redisUrl');
  });

  it('loads safe ingestor lease defaults and rejects an unsafe renewal interval', () => {
    expect(loadConfig({ DATA_MODE: 'demo' })).toMatchObject({
      ingestorLeaseTtlMs: 30_000,
      ingestorLeaseRenewMs: 10_000,
    });
    expect(() =>
      loadConfig({ INGESTOR_LEASE_TTL_MS: '30000', INGESTOR_LEASE_RENEW_MS: '16000' }),
    ).toThrow('INGESTOR_LEASE_RENEW_MS must not exceed half of INGESTOR_LEASE_TTL_MS');
  });

  it('resolves the default airport data path from the configured application base', () => {
    expect(loadConfig({ NODE_ENV: 'test' }, { baseDir: '/srv/hangban' }).airportsDataPath).toBe(
      resolve('/srv/hangban/data/airports.json'),
    );
  });

  it('uses the workspace application root by default instead of the package process cwd', () => {
    const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
    expect(loadConfig({ NODE_ENV: 'test' }).airportsDataPath).toBe(
      resolve(workspaceRoot, 'data/airports.json'),
    );
  });

  it('resolves an explicit relative airport path from the configured application base', () => {
    expect(
      loadConfig({ AIRPORTS_DATA_PATH: 'var/airports.json' }, { baseDir: '/srv/hangban' })
        .airportsDataPath,
    ).toBe(resolve('/srv/hangban/var/airports.json'));
  });

  it('preserves an explicit absolute airport path', () => {
    expect(
      loadConfig(
        { AIRPORTS_DATA_PATH: '/var/lib/hangban/airports.json' },
        { baseDir: '/srv/hangban' },
      ).airportsDataPath,
    ).toBe('/var/lib/hangban/airports.json');
  });

  it('loads GeoNames and ADSBdb defaults and resolves the city data path', () => {
    const config = loadConfig(
      {
        GEONAMES_CITIES_URL: 'https://download.test/cities500.zip',
        GEONAMES_ALTERNATE_NAMES_URL: 'https://download.test/alternateNamesV2.zip',
        ADSBDB_BASE_URL: 'https://api.adsbdb.test/v0',
      },
      { baseDir: '/srv/hangban' },
    );

    expect(config).toMatchObject({
      geonamesCitiesUrl: 'https://download.test/cities500.zip',
      geonamesAlternateNamesUrl: 'https://download.test/alternateNamesV2.zip',
      geonamesDataPath: resolve('/srv/hangban/data/cities.json'),
      geonamesSyncTimeoutMs: 14_400_000,
      adsbdbBaseUrl: 'https://api.adsbdb.test/v0',
      adsbdbConcurrency: 4,
      adsbdbTimeoutMs: 5_000,
      adsbdbAircraftCacheTtlMs: 86_400_000,
      adsbdbRouteCacheTtlMs: 21_600_000,
      adsbdbNegativeCacheTtlMs: 300_000,
    });
  });

  it('allows the GeoNames bulk sync timeout to be overridden', () => {
    expect(loadConfig({ GEONAMES_SYNC_TIMEOUT_MS: '7200000' }).geonamesSyncTimeoutMs).toBe(
      7_200_000,
    );
  });

  it('rejects invalid ADSBdb concurrency and cache durations', () => {
    expect(() => loadConfig({ ADSBDB_CONCURRENCY: '0' })).toThrow();
    expect(() => loadConfig({ ADSBDB_CONCURRENCY: '17' })).toThrow();
    expect(() => loadConfig({ ADSBDB_TIMEOUT_MS: '0' })).toThrow();
    expect(() => loadConfig({ ADSBDB_NEGATIVE_CACHE_TTL_MS: '-1' })).toThrow();
  });

  it('rejects an invalid API port', () => {
    expect(() => loadConfig({ API_PORT: '70000' })).toThrow();
  });

  it('accepts explicit demo mode', () => {
    expect(loadConfig({ DATA_MODE: 'demo' }).dataMode).toBe('demo');
  });

  it('preserves the configured live provider order', () => {
    expect(
      loadConfig({
        DATA_MODE: 'live',
        LIVE_PROVIDERS: 'adsb-lol,airplanes-live',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
        REDIS_URL: 'redis://:test@127.0.0.1:6379',
      }).liveProviders,
    ).toEqual(['adsb-lol', 'airplanes-live']);
  });

  it('requires OpenSky OAuth credentials as a pair', () => {
    expect(() =>
      loadConfig({
        DATA_MODE: 'live',
        LIVE_PROVIDERS: 'opensky',
        OPENSKY_CLIENT_ID: 'client-only',
      }),
    ).toThrow();
  });

  it('rejects hybrid mode', () => {
    expect(() => loadConfig({ DATA_MODE: 'hybrid' })).toThrow();
  });

  it('trims and deduplicates live providers', () => {
    expect(
      loadConfig({
        DATA_MODE: 'live',
        LIVE_PROVIDERS: ' adsb-lol,opensky,adsb-lol ',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
        REDIS_URL: 'redis://:test@127.0.0.1:6379',
      }).liveProviders,
    ).toEqual(['adsb-lol', 'opensky']);
  });

  it('rejects unknown and empty live provider lists', () => {
    expect(() => loadConfig({ DATA_MODE: 'live', LIVE_PROVIDERS: 'unknown' })).toThrow();
    expect(() => loadConfig({ DATA_MODE: 'live', LIVE_PROVIDERS: '' })).toThrow();
  });

  it('parses valid default bounding boxes and rejects invalid ones', () => {
    expect(
      loadConfig({ LIVE_DEFAULT_BBOXES: '100,20,130,50; -10,-20,10,20' }).liveDefaultBboxes,
    ).toEqual([
      [100, 20, 130, 50],
      [-10, -20, 10, 20],
    ]);
    expect(() => loadConfig({ LIVE_DEFAULT_BBOXES: '100,50,130,20' })).toThrow();
  });

  it('rejects malformed default bounding boxes', () => {
    expect(() => loadConfig({ LIVE_DEFAULT_BBOXES: '100,,130,50' })).toThrow();
    expect(() => loadConfig({ LIVE_DEFAULT_BBOXES: '100,20,130' })).toThrow();
    expect(() => loadConfig({ LIVE_DEFAULT_BBOXES: '100,20,nope,50' })).toThrow();
    expect(() => loadConfig({ LIVE_DEFAULT_BBOXES: '181,20,190,50' })).toThrow();
  });

  it('normalizes whitespace-only OpenSky credentials as absent', () => {
    expect(
      loadConfig({ OPENSKY_CLIENT_ID: '   ', OPENSKY_CLIENT_SECRET: '\t' }),
    ).not.toHaveProperty('openSkyClientId');
    expect(() => loadConfig({ OPENSKY_CLIENT_SECRET: 'secret-only' })).toThrow();
    expect(() =>
      loadConfig({ OPENSKY_CLIENT_ID: 'client', OPENSKY_CLIENT_SECRET: '   ' }),
    ).toThrow();
  });
});
