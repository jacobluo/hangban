import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '@hangban/config';
import type { WeatherRadarStatus } from '@hangban/contracts';
import { airports, createDemoFlights, createDemoSourceStatuses } from '@hangban/testkit';

import { buildApp, createApiRuntime, createConfiguredWeatherRadarService } from '../app';
import { createMemoryRepository } from '../memory-repository';
import {
  createDisabledWeatherRadarService,
  type WeatherRadarService,
  WeatherRadarServiceError,
} from '../weather-radar-service';

const NOW = new Date('2026-07-13T08:10:00.000Z');
const AVAILABLE_STATUS: WeatherRadarStatus = {
  available: true,
  providerId: 'rainviewer',
  frameId: 'frame-1783929600',
  frameTime: '2026-07-13T08:00:00.000Z',
  freshness: 'latest',
  tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
  attribution: {
    label: 'Weather radar by RainViewer',
    url: 'https://www.rainviewer.com/',
  },
};

function radarService(overrides: Partial<WeatherRadarService> = {}): WeatherRadarService {
  return {
    status: async () => AVAILABLE_STATUS,
    tile: async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]),
      cacheMaxAgeSeconds: 300,
    }),
    clear: vi.fn(),
    ...overrides,
  };
}

function buildTestApp(weatherRadarService: WeatherRadarService) {
  return buildApp({
    repository: createMemoryRepository({
      airports,
      flights: createDemoFlights(NOW),
      sourceStatuses: createDemoSourceStatuses(NOW),
    }),
    weatherRadarService,
    now: () => NOW,
    logger: false,
  });
}

describe('weather radar routes', () => {
  const apps: ReturnType<typeof buildTestApp>[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it('returns an internal tile template without upstream details', async () => {
    const app = buildTestApp(radarService());
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/weather/radar' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      available: true,
      tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
    });
    expect(response.body).not.toContain('tilecache.rainviewer.com');
  });

  it('returns PNG bytes with the service-bounded cache lifetime', async () => {
    const app = buildTestApp(radarService());
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/weather/radar/tiles/frame-1783929600/7/1/2.png',
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toBe('public, max-age=300, must-revalidate');
  });

  it('uses a zero-second cache lifetime without stale reuse', async () => {
    const app = buildTestApp(
      radarService({
        tile: async () => ({
          bytes: new Uint8Array([137, 80, 78, 71]),
          cacheMaxAgeSeconds: 0,
        }),
      }),
    );
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/weather/radar/tiles/frame-1783929600/7/1/2.png',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  });

  it('returns the stable disabled status', async () => {
    const app = buildTestApp(createDisabledWeatherRadarService());
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/weather/radar' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      available: false,
      providerId: 'rainviewer',
      reason: 'DISABLED',
    });
  });

  it.each([
    ['invalid frame', '/api/v1/weather/radar/tiles/not-a-frame/1/0/0.png'],
    ['excess zoom', '/api/v1/weather/radar/tiles/frame-1783929600/8/0/0.png'],
    ['out-of-range x', '/api/v1/weather/radar/tiles/frame-1783929600/2/4/0.png'],
    ['out-of-range y', '/api/v1/weather/radar/tiles/frame-1783929600/2/0/4.png'],
  ])('rejects %s with a stable request error', async (_name, url) => {
    const tile = vi.fn<WeatherRadarService['tile']>();
    const app = buildTestApp(radarService({ tile }));
    apps.push(app);

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'WEATHER_RADAR_REQUEST_INVALID',
      message: '天气雷达瓦片请求无效',
    });
    expect(tile).not.toHaveBeenCalled();
  });

  it('maps an unknown or expired frame to a stable not-found error', async () => {
    const app = buildTestApp(
      radarService({
        tile: async () => {
          throw new WeatherRadarServiceError('FRAME_UNAVAILABLE', 'secret frame detail');
        },
      }),
    );
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/weather/radar/tiles/frame-1783929600/7/1/2.png',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: 'WEATHER_RADAR_FRAME_UNAVAILABLE',
      message: '天气雷达帧不可用',
    });
    expect(response.body).not.toContain('secret');
    expect(response.headers['cache-control']).toBeUndefined();
  });

  it('maps upstream tile failures to a stable unavailable error without leaking details', async () => {
    const app = buildTestApp(
      radarService({
        tile: async () => {
          throw new WeatherRadarServiceError(
            'UPSTREAM_UNAVAILABLE',
            'https://tilecache.rainviewer.com/private upstream body',
          );
        },
      }),
    );
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/weather/radar/tiles/frame-1783929600/7/1/2.png',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 'WEATHER_RADAR_UPSTREAM_UNAVAILABLE',
      message: '天气雷达数据暂不可用',
    });
    expect(response.body).not.toContain('tilecache.rainviewer.com');
    expect(response.body).not.toContain('upstream body');
    expect(response.headers['cache-control']).toBeUndefined();
  });

  it('keeps flight map routes available after a radar failure', async () => {
    const app = buildTestApp(
      radarService({
        status: async () => {
          throw new Error('internal upstream failure');
        },
      }),
    );
    apps.push(app);

    const radarResponse = await app.inject({ method: 'GET', url: '/api/v1/weather/radar' });
    const mapResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/map/snapshot?bbox=100,20,130,50',
    });

    expect(radarResponse.statusCode).toBe(503);
    expect(radarResponse.body).not.toContain('internal upstream failure');
    expect(mapResponse.statusCode).toBe(200);
  });

  it('clears the injected weather radar service when Fastify closes', async () => {
    const clear = vi.fn();
    const app = buildTestApp(radarService({ clear }));
    apps.push(app);

    await app.close();
    apps.pop();

    expect(clear).toHaveBeenCalledOnce();
  });
});

describe('configured weather radar runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defers network access until the first status request in demo mode', async () => {
    const runtimeNow = new Date('2020-01-01T00:10:00.000Z');
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        host: 'https://tilecache.rainviewer.com',
        radar: {
          past: [{ time: 1_577_836_800, path: '/v2/radar/current' }],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const runtime = createApiRuntime({
      config: loadConfig({ DATA_MODE: 'demo', WEATHER_RADAR_ENABLED: 'true' }),
      airports,
      logger: false,
      now: () => runtimeNow,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const response = await runtime.app.inject({ method: 'GET', url: '/api/v1/weather/radar' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ available: true, frameId: 'frame-1577836800' });
    expect(fetchMock).toHaveBeenCalledOnce();
    await runtime.app.close();
  });

  it('keeps disabled weather radar offline when status is requested', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const service = createConfiguredWeatherRadarService(
      loadConfig({
        DATA_MODE: 'live',
        WEATHER_RADAR_ENABLED: 'false',
        DATABASE_URL: 'postgres://db',
        REDIS_URL: 'redis://cache',
      }),
    );

    await expect(service.status()).resolves.toMatchObject({ available: false, reason: 'DISABLED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
