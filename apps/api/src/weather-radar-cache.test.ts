import { describe, expect, it } from 'vitest';

import type { WeatherRadarProviderFrame } from '@hangban/adapters';

import { createWeatherRadarCache } from './weather-radar-cache';

const DAY_MS = 86_400_000;

function frame(id: string, time = '2026-07-13T08:00:00.000Z'): WeatherRadarProviderFrame {
  return {
    providerId: 'rainviewer',
    frameId: id,
    frameTime: time,
    upstreamHost: 'https://tilecache.rainviewer.com',
    upstreamPath: '/v2/radar/current',
  };
}

describe('weather radar cache', () => {
  it('evicts the least recently used entry by total bytes and expires at 24 hours', () => {
    let now = 0;
    const cache = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 2,
      maxBytes: 4,
      now: () => now,
    });

    cache.setTile('a', new Uint8Array([1, 2]));
    cache.setTile('b', new Uint8Array([3, 4]));
    expect(cache.getTile('a')).toEqual(new Uint8Array([1, 2]));
    cache.setTile('c', new Uint8Array([5, 6]));

    expect(cache.getTile('b')).toBeNull();
    expect(cache.stats()).toEqual({ entries: 2, bytes: 4 });
    now = DAY_MS + 1;
    expect(cache.getTile('a')).toBeNull();
  });

  it('updates byte accounting when a tile is overwritten and returns copies', () => {
    const cache = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 2,
      maxBytes: 4,
      now: () => 0,
    });
    const source = new Uint8Array([1, 2]);
    cache.setTile('tile', source);
    source[0] = 9;
    expect(cache.getTile('tile')).toEqual(new Uint8Array([1, 2]));

    cache.setTile('tile', new Uint8Array([3, 4, 5]));

    const cached = cache.getTile('tile');
    expect(cached).toEqual(new Uint8Array([3, 4, 5]));
    cached![0] = 9;
    expect(cache.getTile('tile')).toEqual(new Uint8Array([3, 4, 5]));
    expect(cache.stats()).toEqual({ entries: 1, bytes: 3 });
  });

  it('evicts a single entry larger than maxBytes', () => {
    const cache = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 2,
      maxBytes: 2,
      now: () => 0,
    });

    cache.setTile('oversized', new Uint8Array([1, 2, 3]));

    expect(cache.getTile('oversized')).toBeNull();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('enforces byte and entry limits independently', () => {
    const byteBounded = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 10,
      maxBytes: 3,
      now: () => 0,
    });
    byteBounded.setTile('a', new Uint8Array([1, 2]));
    byteBounded.setTile('b', new Uint8Array([3, 4]));
    expect(byteBounded.getTile('a')).toBeNull();
    expect(byteBounded.stats()).toEqual({ entries: 1, bytes: 2 });

    const entryBounded = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 1,
      maxBytes: 100,
      now: () => 0,
    });
    entryBounded.setTile('a', new Uint8Array([1]));
    entryBounded.setTile('b', new Uint8Array([2]));
    expect(entryBounded.getTile('a')).toBeNull();
    expect(entryBounded.stats()).toEqual({ entries: 1, bytes: 1 });
  });

  it('registers frames, selects the newest frame, and clears all memory', () => {
    const cache = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 3,
      maxBytes: 4_096,
      now: () => 0,
    });
    cache.setFrame(frame('frame-1', '2026-07-13T07:00:00.000Z'));
    cache.setFrame(frame('frame-2', '2026-07-13T08:00:00.000Z'));

    expect(cache.getFrame('frame-1')).toEqual(frame('frame-1', '2026-07-13T07:00:00.000Z'));
    expect(cache.newestFrame()).toEqual(frame('frame-2', '2026-07-13T08:00:00.000Z'));
    cache.clear();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(cache.newestFrame()).toBeNull();
  });

  it('reports the remaining frame TTL without extending it on read', () => {
    let now = 1_000;
    const cache = createWeatherRadarCache({
      ttlMs: 120_000,
      maxEntries: 2,
      maxBytes: 4_096,
      now: () => now,
    });
    cache.setFrame(frame('frame-1'));

    expect(cache.remainingTtlMsForFrame('frame-1')).toBe(120_000);
    now += 45_000;
    expect(cache.getFrame('frame-1')).not.toBeNull();
    expect(cache.remainingTtlMsForFrame('frame-1')).toBe(75_000);
    now += 75_001;
    expect(cache.remainingTtlMsForFrame('frame-1')).toBeNull();
  });

  it('sets expired entry bytes back to zero', () => {
    let now = 0;
    const cache = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 2,
      maxBytes: 10,
      now: () => now,
    });
    cache.setTile('tile', new Uint8Array([1, 2, 3]));
    now = DAY_MS + 1;

    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('keeps a touched entry most-recently-used when the raw clock rolls back', () => {
    let now = 100;
    const cache = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 2,
      maxBytes: 10,
      now: () => now,
    });
    cache.setTile('a', new Uint8Array([1]));
    now = 200;
    cache.setTile('b', new Uint8Array([2]));
    now = 50;
    expect(cache.getTile('a')).toEqual(new Uint8Array([1]));
    cache.setTile('c', new Uint8Array([3]));

    expect(cache.getTile('a')).toEqual(new Uint8Array([1]));
    expect(cache.getTile('b')).toBeNull();
    expect(cache.getTile('c')).toEqual(new Uint8Array([3]));
  });

  it('uses non-decreasing effective time for writes after a clock rollback', () => {
    let now = DAY_MS;
    const cache = createWeatherRadarCache({
      ttlMs: DAY_MS,
      maxEntries: 2,
      maxBytes: 10,
      now: () => now,
    });
    cache.setTile('anchor', new Uint8Array([1]));
    now = 0;
    cache.setTile('after-rollback', new Uint8Array([2]));

    now = DAY_MS + 1;
    expect(cache.getTile('after-rollback')).toEqual(new Uint8Array([2]));
    now = 2 * DAY_MS + 1;
    expect(cache.getTile('after-rollback')).toBeNull();
  });

  it('rejects a TTL longer than 24 hours', () => {
    expect(() =>
      createWeatherRadarCache({
        ttlMs: DAY_MS + 1,
        maxEntries: 1,
        maxBytes: 1,
      }),
    ).toThrow(/24 hours/);
  });
});
