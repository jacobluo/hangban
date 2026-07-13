import type { WeatherRadarProvider, WeatherRadarProviderFrame } from '@hangban/adapters';
import type { WeatherRadarFreshness, WeatherRadarStatus } from '@hangban/contracts';

import type { WeatherRadarCache } from './weather-radar-cache';

const LATEST_AGE_MS = 15 * 60_000;
const DELAYED_AGE_MS = 2 * 60 * 60_000;
const MAX_FRAME_AGE_MS = 86_400_000;
const MAX_PUBLIC_TILE_CACHE_MS = 5 * 60_000;

const attribution = {
  label: 'Weather radar by RainViewer' as const,
  url: 'https://www.rainviewer.com/' as const,
};

export type WeatherRadarServiceErrorCode =
  'INVALID_REQUEST' | 'FRAME_UNAVAILABLE' | 'UPSTREAM_UNAVAILABLE';

export class WeatherRadarServiceError extends Error {
  constructor(
    public readonly code: WeatherRadarServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WeatherRadarServiceError';
  }
}

export type WeatherRadarService = {
  status(): Promise<WeatherRadarStatus>;
  tile(frameId: string, z: number, x: number, y: number): Promise<WeatherRadarTileResult>;
  clear(): void;
};

export type WeatherRadarTileResult = {
  bytes: Uint8Array;
  cacheMaxAgeSeconds: number;
};

type WeatherRadarServiceOptions = {
  enabled: boolean;
  provider: WeatherRadarProvider;
  cache: WeatherRadarCache;
  now?: () => Date;
  maxZoom: number;
};

function frameAge(frame: WeatherRadarProviderFrame, now: Date): number | null {
  const frameTimestamp = Date.parse(frame.frameTime);
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(frameTimestamp) || !Number.isFinite(nowTimestamp)) return null;
  return Math.max(0, nowTimestamp - frameTimestamp);
}

function freshnessFor(ageMs: number): WeatherRadarFreshness | null {
  if (ageMs < LATEST_AGE_MS) return 'latest';
  if (ageMs < DELAYED_AGE_MS) return 'delayed';
  if (ageMs <= MAX_FRAME_AGE_MS) return 'historical-cache';
  return null;
}

function availableStatus(
  frame: WeatherRadarProviderFrame,
  freshness: WeatherRadarFreshness,
): WeatherRadarStatus {
  return {
    available: true,
    providerId: 'rainviewer',
    frameId: frame.frameId,
    frameTime: frame.frameTime,
    freshness,
    tileTemplate: `/api/v1/weather/radar/tiles/${frame.frameId}/{z}/{x}/{y}.png`,
    attribution,
  };
}

export function createWeatherRadarService({
  enabled,
  provider,
  cache,
  now = () => new Date(),
  maxZoom,
}: WeatherRadarServiceOptions): WeatherRadarService {
  const inFlightTiles = new Map<string, Promise<Uint8Array>>();
  let lastRegisteredFrameTime: number | undefined;
  let generation = 0;

  const unavailable = (
    reason: Extract<WeatherRadarStatus, { available: false }>['reason'],
  ): WeatherRadarStatus => ({ available: false, providerId: 'rainviewer', reason });

  const statusFromFrame = (frame: WeatherRadarProviderFrame): WeatherRadarStatus => {
    const ageMs = frameAge(frame, now());
    if (ageMs === null) return unavailable('NO_VALID_FRAME');
    const freshness = freshnessFor(ageMs);
    if (!freshness) return unavailable('FRAME_EXPIRED');
    return availableStatus(frame, freshness);
  };

  const fallbackStatus = (): WeatherRadarStatus => {
    const cached = cache.newestFrame();
    if (cached) return statusFromFrame(cached);
    if (
      lastRegisteredFrameTime !== undefined &&
      now().getTime() - lastRegisteredFrameTime > MAX_FRAME_AGE_MS
    ) {
      return unavailable('FRAME_EXPIRED');
    }
    return unavailable('UPSTREAM_UNAVAILABLE');
  };

  const tileResult = (
    frame: WeatherRadarProviderFrame,
    bytes: Uint8Array,
    cacheEligible = true,
  ): WeatherRadarTileResult => {
    const ageMs = frameAge(frame, now());
    if (ageMs === null || ageMs > MAX_FRAME_AGE_MS) {
      throw new WeatherRadarServiceError('FRAME_UNAVAILABLE', 'Weather radar frame is unavailable');
    }
    const cacheRemainingMs = cacheEligible ? (cache.remainingTtlMsForFrame(frame.frameId) ?? 0) : 0;
    const frameRemainingMs = Math.max(0, MAX_FRAME_AGE_MS - ageMs);
    const maxAgeMs = Math.max(
      0,
      Math.min(MAX_PUBLIC_TILE_CACHE_MS, cacheRemainingMs, frameRemainingMs),
    );
    return {
      bytes: new Uint8Array(bytes),
      cacheMaxAgeSeconds: Math.floor(maxAgeMs / 1_000),
    };
  };

  return {
    async status() {
      if (!enabled) return unavailable('DISABLED');

      const requestGeneration = generation;
      let frame: WeatherRadarProviderFrame;
      try {
        frame = await provider.fetchLatestFrame();
      } catch {
        return fallbackStatus();
      }
      if (generation !== requestGeneration) return fallbackStatus();

      const timestamp = Date.parse(frame.frameTime);
      if (!Number.isFinite(timestamp)) return unavailable('NO_VALID_FRAME');
      cache.setFrame(frame);
      if (generation !== requestGeneration) return fallbackStatus();
      lastRegisteredFrameTime = timestamp;
      const registeredFrame = cache.getFrame(frame.frameId);
      if (generation !== requestGeneration) return fallbackStatus();
      if (!registeredFrame) return unavailable('NO_VALID_FRAME');
      return statusFromFrame(frame);
    },

    async tile(frameId, z, x, y) {
      if (
        !Number.isInteger(z) ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        z < 0 ||
        z > maxZoom ||
        x < 0 ||
        y < 0 ||
        x >= 2 ** z ||
        y >= 2 ** z
      ) {
        throw new WeatherRadarServiceError(
          'INVALID_REQUEST',
          'Weather radar tile coordinates are invalid',
        );
      }
      if (!enabled) {
        throw new WeatherRadarServiceError(
          'FRAME_UNAVAILABLE',
          'Weather radar frame is unavailable',
        );
      }

      const frame = cache.getFrame(frameId);
      const requestGeneration = generation;
      const ageMs = frame ? frameAge(frame, now()) : null;
      if (!frame || ageMs === null || ageMs > MAX_FRAME_AGE_MS) {
        throw new WeatherRadarServiceError(
          'FRAME_UNAVAILABLE',
          'Weather radar frame is unavailable',
        );
      }

      const key = `${frameId}:${z}:${x}:${y}`;
      const cached = cache.getTile(key);
      if (cached) return tileResult(frame, cached);

      let request = inFlightTiles.get(key);
      if (!request) {
        const tileFetchGeneration = generation;
        request = provider
          .fetchTile(frame, z, x, y)
          .then(({ bytes }) => {
            if (generation === tileFetchGeneration) cache.setTile(key, bytes);
            return bytes;
          })
          .catch(() => {
            throw new WeatherRadarServiceError(
              'UPSTREAM_UNAVAILABLE',
              'Weather radar tile is unavailable',
            );
          })
          .finally(() => {
            if (inFlightTiles.get(key) === request) inFlightTiles.delete(key);
          });
        inFlightTiles.set(key, request);
      }
      return tileResult(frame, await request, generation === requestGeneration);
    },

    clear() {
      generation += 1;
      inFlightTiles.clear();
      lastRegisteredFrameTime = undefined;
      cache.clear();
    },
  };
}

export function createDisabledWeatherRadarService(): WeatherRadarService {
  return {
    async status() {
      return { available: false, providerId: 'rainviewer', reason: 'DISABLED' };
    },
    async tile() {
      throw new WeatherRadarServiceError('FRAME_UNAVAILABLE', 'Weather radar frame is unavailable');
    },
    clear() {},
  };
}
