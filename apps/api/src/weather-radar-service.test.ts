import { describe, expect, it, vi } from 'vitest';

import {
  WeatherRadarProviderError,
  type WeatherRadarProvider,
  type WeatherRadarProviderFrame,
} from '@hangban/adapters';

import { createWeatherRadarCache } from './weather-radar-cache';
import {
  createDisabledWeatherRadarService,
  createWeatherRadarService,
  WeatherRadarServiceError,
} from './weather-radar-service';

const DAY_MS = 86_400_000;
const BASE_TIME = new Date('2026-07-13T08:00:00.000Z');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function radarFrame(frameTime = BASE_TIME): WeatherRadarProviderFrame {
  return {
    providerId: 'rainviewer',
    frameId: `frame-${Math.floor(frameTime.getTime() / 1_000)}`,
    frameTime: frameTime.toISOString(),
    upstreamHost: 'https://tilecache.rainviewer.com',
    upstreamPath: '/v2/radar/current',
  };
}

function providerReturningFrame(frameTime = BASE_TIME): WeatherRadarProvider {
  return {
    async fetchLatestFrame() {
      return radarFrame(frameTime);
    },
    async fetchTile() {
      return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };
    },
  };
}

function validOptions({
  provider,
  now = () => BASE_TIME,
  enabled = true,
  maxZoom = 7,
}: {
  provider: WeatherRadarProvider;
  now?: () => Date;
  enabled?: boolean;
  maxZoom?: number;
}) {
  return {
    enabled,
    provider,
    cache: createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 32,
      maxBytes: 4_096,
      now: () => now().getTime(),
    }),
    now,
    maxZoom,
  };
}

describe('weather radar service', () => {
  it.each([
    [14 * 60_000, 'latest'],
    [15 * 60_000, 'delayed'],
    [2 * 60 * 60_000 - 1, 'delayed'],
    [2 * 60 * 60_000, 'historical-cache'],
    [DAY_MS, 'historical-cache'],
  ] as const)('classifies a frame aged %i ms as %s', async (ageMs, freshness) => {
    const provider = providerReturningFrame(new Date(BASE_TIME.getTime() - ageMs));
    const service = createWeatherRadarService(validOptions({ provider }));

    await expect(service.status()).resolves.toMatchObject({ available: true, freshness });
  });

  it('returns an exact same-origin available status without upstream frame details', async () => {
    const service = createWeatherRadarService(
      validOptions({ provider: providerReturningFrame(BASE_TIME) }),
    );

    await expect(service.status()).resolves.toEqual({
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
    });
  });

  it('does not register a status request that finishes after clear', async () => {
    let now = new Date(BASE_TIME);
    let upstreamFails = false;
    const pendingFrame = deferred<WeatherRadarProviderFrame>();
    const provider: WeatherRadarProvider = {
      async fetchLatestFrame() {
        if (upstreamFails) throw new WeatherRadarProviderError('UPSTREAM_ERROR', 'down');
        return pendingFrame.promise;
      },
      async fetchTile() {
        return { bytes: new Uint8Array([1]), contentType: 'image/png' };
      },
    };
    const options = validOptions({ provider, now: () => new Date(now) });
    const service = createWeatherRadarService(options);
    const statusRequest = service.status();

    service.clear();
    pendingFrame.resolve(radarFrame(BASE_TIME));

    await expect(statusRequest).resolves.toEqual({
      available: false,
      providerId: 'rainviewer',
      reason: 'UPSTREAM_UNAVAILABLE',
    });
    expect(options.cache.stats()).toEqual({ entries: 0, bytes: 0 });

    upstreamFails = true;
    now = new Date(BASE_TIME.getTime() + DAY_MS + 1);
    await expect(service.status()).resolves.toEqual({
      available: false,
      providerId: 'rainviewer',
      reason: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('uses cached data for at most 24 hours after upstream failure', async () => {
    let now = new Date(BASE_TIME);
    let upstreamFails = false;
    const provider: WeatherRadarProvider = {
      async fetchLatestFrame() {
        if (upstreamFails) throw new WeatherRadarProviderError('UPSTREAM_ERROR', 'down');
        return radarFrame(BASE_TIME);
      },
      async fetchTile() {
        return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };
      },
    };
    const service = createWeatherRadarService(validOptions({ provider, now: () => new Date(now) }));

    await expect(service.status()).resolves.toMatchObject({ available: true, freshness: 'latest' });
    upstreamFails = true;
    now = new Date(BASE_TIME.getTime() + 23 * 60 * 60_000);
    await expect(service.status()).resolves.toMatchObject({
      available: true,
      freshness: 'historical-cache',
    });
    now = new Date(BASE_TIME.getTime() + DAY_MS);
    await expect(service.status()).resolves.toMatchObject({
      available: true,
      freshness: 'historical-cache',
    });
    now = new Date(BASE_TIME.getTime() + DAY_MS + 1);
    await expect(service.status()).resolves.toEqual({
      available: false,
      providerId: 'rainviewer',
      reason: 'FRAME_EXPIRED',
    });
  });

  it('does not call the provider when disabled', async () => {
    const provider = providerReturningFrame();
    const fetchLatestFrame = vi.spyOn(provider, 'fetchLatestFrame');
    const service = createWeatherRadarService(validOptions({ provider, enabled: false }));

    await expect(service.status()).resolves.toEqual({
      available: false,
      providerId: 'rainviewer',
      reason: 'DISABLED',
    });
    expect(fetchLatestFrame).not.toHaveBeenCalled();
  });

  it('returns UPSTREAM_UNAVAILABLE when upstream fails without a cached frame', async () => {
    const provider = providerReturningFrame();
    provider.fetchLatestFrame = async () => {
      throw new WeatherRadarProviderError('UPSTREAM_ERROR', 'internal upstream detail');
    };
    const service = createWeatherRadarService(validOptions({ provider }));

    await expect(service.status()).resolves.toEqual({
      available: false,
      providerId: 'rainviewer',
      reason: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('deduplicates concurrent tile requests and caches independent byte copies', async () => {
    const provider = providerReturningFrame();
    const fetchTile = vi.spyOn(provider, 'fetchTile');
    const service = createWeatherRadarService(validOptions({ provider }));
    const status = await service.status();
    if (!status.available) throw new Error('expected an available frame');

    const [first, second] = await Promise.all([
      service.tile(status.frameId, 7, 1, 2),
      service.tile(status.frameId, 7, 1, 2),
    ]);
    first[0] = 0;
    second[1] = 0;
    const third = await service.tile(status.frameId, 7, 1, 2);

    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect(fetchTile).toHaveBeenCalledWith(
      expect.objectContaining({ frameId: status.frameId }),
      7,
      1,
      2,
    );
    expect(third).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('does not let an old tile finally delete a newer same-key request after clear', async () => {
    const firstTile = deferred<{
      bytes: Uint8Array;
      contentType: 'image/png';
    }>();
    const secondTile = deferred<{
      bytes: Uint8Array;
      contentType: 'image/png';
    }>();
    const provider = providerReturningFrame();
    const fetchTile = vi
      .spyOn(provider, 'fetchTile')
      .mockImplementationOnce(async () => firstTile.promise)
      .mockImplementationOnce(async () => secondTile.promise);
    const service = createWeatherRadarService(validOptions({ provider }));
    const firstStatus = await service.status();
    if (!firstStatus.available) throw new Error('expected an available frame');
    const firstRequest = service.tile(firstStatus.frameId, 7, 1, 2);

    service.clear();
    const secondStatus = await service.status();
    if (!secondStatus.available) throw new Error('expected a re-registered frame');
    const secondRequest = service.tile(secondStatus.frameId, 7, 1, 2);

    firstTile.resolve({ bytes: new Uint8Array([1]), contentType: 'image/png' });
    await expect(firstRequest).resolves.toEqual(new Uint8Array([1]));
    const thirdRequest = service.tile(secondStatus.frameId, 7, 1, 2);
    expect(fetchTile).toHaveBeenCalledTimes(2);

    secondTile.resolve({ bytes: new Uint8Array([2]), contentType: 'image/png' });
    await expect(Promise.all([secondRequest, thirdRequest])).resolves.toEqual([
      new Uint8Array([2]),
      new Uint8Array([2]),
    ]);
    expect(fetchTile).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['frame-1', 0, 0, 0, 'FRAME_UNAVAILABLE'],
    ['registered', 8, 0, 0, 'INVALID_REQUEST'],
    ['registered', -1, 0, 0, 'INVALID_REQUEST'],
    ['registered', 2, 4, 0, 'INVALID_REQUEST'],
    ['registered', 2, 0, 4, 'INVALID_REQUEST'],
    ['registered', 2, 1.5, 0, 'INVALID_REQUEST'],
  ] as const)(
    'rejects invalid tile input (%s, %i, %i, %i)',
    async (frameIdKind, z, x, y, expectedCode) => {
      const provider = providerReturningFrame();
      const fetchTile = vi.spyOn(provider, 'fetchTile');
      const service = createWeatherRadarService(validOptions({ provider }));
      const status = await service.status();
      if (!status.available) throw new Error('expected an available frame');
      const frameId = frameIdKind === 'registered' ? status.frameId : frameIdKind;

      await expect(service.tile(frameId, z, x, y)).rejects.toMatchObject({
        name: 'WeatherRadarServiceError',
        code: expectedCode,
      });
      expect(fetchTile).not.toHaveBeenCalled();
    },
  );

  it('rejects a registered frame after its frame time exceeds 24 hours', async () => {
    let now = new Date(BASE_TIME);
    const provider = providerReturningFrame(BASE_TIME);
    const service = createWeatherRadarService(validOptions({ provider, now: () => new Date(now) }));
    const status = await service.status();
    if (!status.available) throw new Error('expected an available frame');
    now = new Date(BASE_TIME.getTime() + DAY_MS + 1);

    await expect(service.tile(status.frameId, 0, 0, 0)).rejects.toMatchObject({
      code: 'FRAME_UNAVAILABLE',
    });
  });

  it('maps tile provider failures to a stable service error', async () => {
    const provider = providerReturningFrame();
    provider.fetchTile = async () => {
      throw new WeatherRadarProviderError('UPSTREAM_ERROR', 'secret upstream detail');
    };
    const service = createWeatherRadarService(validOptions({ provider }));
    const status = await service.status();
    if (!status.available) throw new Error('expected an available frame');

    await expect(service.tile(status.frameId, 0, 0, 0)).rejects.toEqual(
      new WeatherRadarServiceError('UPSTREAM_UNAVAILABLE', 'Weather radar tile is unavailable'),
    );
  });

  it('provides a disabled service without a provider dependency', async () => {
    const service = createDisabledWeatherRadarService();
    await expect(service.status()).resolves.toEqual({
      available: false,
      providerId: 'rainviewer',
      reason: 'DISABLED',
    });
    await expect(service.tile('frame-1', 0, 0, 0)).rejects.toMatchObject({
      code: 'FRAME_UNAVAILABLE',
    });
    expect(() => service.clear()).not.toThrow();
  });
});
