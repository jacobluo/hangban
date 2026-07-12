import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '@hangban/config';
import type { Flight } from '@hangban/contracts';
import { airports, createDemoFlights, createDemoSourceStatuses } from '@hangban/testkit';

import { buildApp, createApiRuntime } from './app';
import { createMemoryRepository } from './memory-repository';

function createTestApp() {
  const now = new Date('2026-07-11T08:00:00.000Z');
  return buildApp({
    repository: createMemoryRepository({
      airports,
      flights: createDemoFlights(now),
      sourceStatuses: createDemoSourceStatuses(now),
    }),
    now: () => now,
    logger: false,
  });
}

describe('query API', () => {
  const apps: ReturnType<typeof createTestApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it('returns only flights inside the requested viewport', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/map/snapshot?bbox=100,20,130,50',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ flights: Flight[] }>();
    expect(body.flights.length).toBeGreaterThan(0);
    expect(body.flights.every((flight) => flight.longitude >= 100 && flight.longitude <= 130)).toBe(
      true,
    );
  });

  it('groups flight and airport search results', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/search?q=PEK' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ airports: [{ iata: 'PEK' }] });
  });

  it('searches airports globally by localized city name', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=%E6%B7%B1%E5%9C%B3',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ airports: [{ iata: 'SZX', localizedCity: '深圳' }] });
  });

  it('returns only airports in the requested viewport', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/airports?bbox=113,22,114,23&zoom=8&limit=20',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ airports: [{ iata: 'SZX' }], totalInViewport: 1 });
  });

  it('returns spatially nearby flights for an airport', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/airports/PEK/nearby-flights?radiusKm=200',
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ flights: Flight[] }>().flights.map((flight) => flight.callsign),
    ).toContain('MU5102');
  });

  it('rejects invalid bounding boxes with a stable error', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/map/snapshot?bbox=invalid' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('returns a stable unavailable response when the realtime store is disconnected', async () => {
    const app = buildApp({
      repository: createMemoryRepository({
        airports,
        flights: [],
        sourceStatuses: [],
      }),
      realtimeAvailable: () => false,
      logger: false,
    });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/map/snapshot?bbox=100,20,130,50',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'REALTIME_DATA_UNAVAILABLE' });
  });

  it('rejects routes with the same airport', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/routes?origin=PEK&destination=PEK',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_ROUTE' });
  });

  it('allows the configured Web origin', async () => {
    const app = createTestApp();
    apps.push(app);
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/search?q=PEK',
      headers: {
        origin: 'http://127.0.0.1:3000',
        'access-control-request-method': 'GET',
      },
    });
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3000');
  });
});

describe('API data mode startup', () => {
  it('preserves demo seeds and enables the demo movement timer only in demo mode', async () => {
    const runtime = createApiRuntime({
      config: loadConfig({ DATA_MODE: 'demo' }),
      airports,
      logger: false,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    expect(runtime.repository.allFlights().length).toBeGreaterThan(0);
    expect(runtime.repository.sourceStatuses().length).toBeGreaterThan(0);
    expect(runtime.liveIngestion).toBeNull();
    await runtime.app.close();
  });

  it('refuses to assemble live mode with the demo runtime', () => {
    const config = {
      ...loadConfig({ DATA_MODE: 'demo' }),
      dataMode: 'live' as const,
    };
    expect(() => createApiRuntime({ config, airports, logger: false })).toThrow(
      'EXTERNAL_RUNTIME_REQUIRED',
    );
  });
});
