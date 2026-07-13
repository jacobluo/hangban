import type { WeatherRadarProviderFrame } from '@hangban/adapters';

const MAX_TTL_MS = 86_400_000;
const encoder = new TextEncoder();

type CacheEntry =
  | {
      kind: 'frame';
      value: WeatherRadarProviderFrame;
      bytes: number;
      storedAt: number;
      lastUsedAt: number;
      order: number;
    }
  | {
      kind: 'tile';
      value: Uint8Array;
      bytes: number;
      storedAt: number;
      lastUsedAt: number;
      order: number;
    };

export type WeatherRadarCache = {
  setFrame(frame: WeatherRadarProviderFrame): void;
  getFrame(frameId: string): WeatherRadarProviderFrame | null;
  newestFrame(): WeatherRadarProviderFrame | null;
  setTile(key: string, bytes: Uint8Array): void;
  getTile(key: string): Uint8Array | null;
  clear(): void;
  stats(): { entries: number; bytes: number };
};

type WeatherRadarCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  maxBytes: number;
  now?: () => number;
};

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function cloneFrame(frame: WeatherRadarProviderFrame): WeatherRadarProviderFrame {
  return { ...frame };
}

export function createWeatherRadarCache({
  ttlMs,
  maxEntries,
  maxBytes,
  now = Date.now,
}: WeatherRadarCacheOptions): WeatherRadarCache {
  validatePositiveInteger(ttlMs, 'ttlMs');
  validatePositiveInteger(maxEntries, 'maxEntries');
  validatePositiveInteger(maxBytes, 'maxBytes');
  if (ttlMs > MAX_TTL_MS) {
    throw new RangeError('ttlMs must not exceed 24 hours');
  }

  const entries = new Map<string, CacheEntry>();
  let totalBytes = 0;
  let order = 0;
  let lastEffectiveNow = Number.NEGATIVE_INFINITY;

  const effectiveNow = (): number => {
    lastEffectiveNow = Math.max(lastEffectiveNow, now());
    return lastEffectiveNow;
  };

  const frameKey = (frameId: string) => `frame:${frameId}`;
  const tileKey = (key: string) => `tile:${key}`;

  const remove = (key: string): void => {
    const entry = entries.get(key);
    if (!entry) return;
    totalBytes -= entry.bytes;
    entries.delete(key);
  };

  const purgeExpired = (): void => {
    const currentTime = effectiveNow();
    for (const [key, entry] of entries) {
      if (currentTime - entry.storedAt > ttlMs) remove(key);
    }
  };

  const touch = (entry: CacheEntry): void => {
    entry.lastUsedAt = effectiveNow();
    entry.order = ++order;
  };

  const enforceLimits = (): void => {
    purgeExpired();
    while (entries.size > maxEntries || totalBytes > maxBytes) {
      let oldestKey: string | undefined;
      let oldest: CacheEntry | undefined;
      for (const [key, entry] of entries) {
        if (!oldest || entry.order < oldest.order) {
          oldestKey = key;
          oldest = entry;
        }
      }
      if (!oldestKey) break;
      remove(oldestKey);
    }
  };

  const replace = (key: string, entry: CacheEntry): void => {
    remove(key);
    entries.set(key, entry);
    totalBytes += entry.bytes;
    enforceLimits();
  };

  return {
    setFrame(frame) {
      const value = cloneFrame(frame);
      const storedAt = effectiveNow();
      replace(frameKey(frame.frameId), {
        kind: 'frame',
        value,
        bytes: encoder.encode(JSON.stringify(value)).byteLength,
        storedAt,
        lastUsedAt: storedAt,
        order: ++order,
      });
    },

    getFrame(frameId) {
      purgeExpired();
      const entry = entries.get(frameKey(frameId));
      if (!entry || entry.kind !== 'frame') return null;
      touch(entry);
      return cloneFrame(entry.value);
    },

    newestFrame() {
      purgeExpired();
      let newest: Extract<CacheEntry, { kind: 'frame' }> | undefined;
      for (const entry of entries.values()) {
        if (
          entry.kind === 'frame' &&
          (!newest || Date.parse(entry.value.frameTime) > Date.parse(newest.value.frameTime))
        ) {
          newest = entry;
        }
      }
      if (!newest) return null;
      touch(newest);
      return cloneFrame(newest.value);
    },

    setTile(key, bytes) {
      const value = new Uint8Array(bytes);
      const storedAt = effectiveNow();
      replace(tileKey(key), {
        kind: 'tile',
        value,
        bytes: value.byteLength,
        storedAt,
        lastUsedAt: storedAt,
        order: ++order,
      });
    },

    getTile(key) {
      purgeExpired();
      const entry = entries.get(tileKey(key));
      if (!entry || entry.kind !== 'tile') return null;
      touch(entry);
      return new Uint8Array(entry.value);
    },

    clear() {
      entries.clear();
      totalBytes = 0;
    },

    stats() {
      purgeExpired();
      return { entries: entries.size, bytes: totalBytes };
    },
  };
}
