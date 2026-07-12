import {
  ProviderError,
  type FlightPositionProvider,
  type ProviderSnapshot,
} from '@hangban/adapters';
import { describe, expect, it, vi } from 'vitest';

import type { CollectionScope } from './scope-planner';
import { createProviderScheduler, normalizeProviderPolicy } from './provider-scheduler';

const scope = (cacheKey: string): CollectionScope => ({
  bbox: [100, 20, 101, 21],
  latitude: 20.5,
  longitude: 100.5,
  radiusNm: 42,
  cacheKey,
});

const snapshot = (
  providerId: string,
  observedAt = '2026-07-11T08:00:00.000Z',
): ProviderSnapshot => ({
  providerId,
  observedAt,
  flights: [],
});

function provider(providerId: string, implementation: FlightPositionProvider['fetchSnapshot']) {
  return {
    providerId,
    fetchSnapshot: vi.fn(implementation),
  } satisfies FlightPositionProvider;
}

describe('createProviderScheduler', () => {
  it.each(['failure-first', 'success-first'] as const)(
    'keeps provider RATE_LIMITED backoff deterministic when concurrent scopes complete %s',
    async (completionOrder) => {
      let now = 0;
      let rejectA!: (reason: unknown) => void;
      let resolveB!: (value: ProviderSnapshot) => void;
      const pendingA = new Promise<ProviderSnapshot>((_resolve, reject) => {
        rejectA = reject;
      });
      const pendingB = new Promise<ProviderSnapshot>((resolve) => {
        resolveB = resolve;
      });
      const source: FlightPositionProvider = {
        providerId: 'opensky',
        fetchSnapshot: vi.fn(({ bbox }) => (bbox[0] === 100 ? pendingA : pendingB)),
      };
      const scheduler = createProviderScheduler({
        policies: { opensky: { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 10_000 } },
        now: () => now,
      });

      const scopeA = scope('a');
      const scopeB = {
        ...scope('b'),
        bbox: [101, 20, 102, 21] as CollectionScope['bbox'],
      };
      const a = scheduler.fetch(source, scopeA);
      const b = scheduler.fetch(source, scopeB);
      if (completionOrder === 'failure-first') {
        rejectA(new ProviderError('RATE_LIMITED', 'quota', 5_000));
        await expect(a).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        resolveB(snapshot('opensky'));
        await b;
      } else {
        resolveB(snapshot('opensky'));
        await b;
        rejectA(new ProviderError('RATE_LIMITED', 'quota', 5_000));
        await expect(a).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      }

      expect(scheduler.nextAllowedAt('opensky')).toBe(5_000);
      now = 4_999;
      await expect(scheduler.fetch(source, scope('c'))).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        requestAttempted: false,
      });
    },
  );

  it('resets the failure series after backoff expires and a newly started request succeeds', async () => {
    let now = 0;
    let attempt = 0;
    const source = provider('opensky', async () => {
      attempt += 1;
      if (attempt === 1 || attempt === 3) {
        throw new ProviderError('UPSTREAM_ERROR', 'down');
      }
      return snapshot('opensky');
    });
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 10_000 } },
      now: () => now,
    });

    await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(scheduler.nextAllowedAt('opensky')).toBe(1_000);
    now = 1_000;
    await expect(scheduler.fetch(source, scope('b'))).resolves.toMatchObject({
      upstreamSucceeded: true,
    });
    await expect(scheduler.fetch(source, scope('c'))).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(scheduler.nextAllowedAt('opensky')).toBe(2_000);
  });

  it('rotates scope priority only when an upstream request starts across sub-interval cycles', async () => {
    let now = 0;
    const attemptedWest: number[] = [];
    const source: FlightPositionProvider = {
      providerId: 'opensky',
      async fetchSnapshot({ bbox }) {
        attemptedWest.push(bbox[0]);
        return snapshot('opensky', new Date(now).toISOString());
      },
    };
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 1_000, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
      now: () => now,
    });
    const candidates = [scope('a'), scope('b'), scope('c')].map((item, index) => ({
      ...item,
      bbox: [100 + index, 20, 101 + index, 21] as CollectionScope['bbox'],
    }));

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const prioritized = scheduler.prioritizeScopes('opensky', candidates);
      const results = await Promise.allSettled(
        prioritized.map((candidate) => scheduler.fetch(source, candidate)),
      );
      expect(results).toHaveLength(3);
      now += 500;
    }

    expect(attemptedWest).toEqual([100, 101, 102]);
  });

  it('does not advance fairness during backoff and resumes with the next scope after a failed attempt', async () => {
    let now = 0;
    const attemptedKeys: string[] = [];
    const source = provider('opensky', async () => {
      const key = attemptedKeys.length === 0 ? 'a' : 'b';
      attemptedKeys.push(key);
      if (attemptedKeys.length === 1) throw new ProviderError('UPSTREAM_ERROR', 'down');
      return snapshot('opensky');
    });
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 1_000, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
      now: () => now,
    });
    const candidates = [scope('a'), scope('b')];

    for (const timestamp of [0, 500, 1_000]) {
      now = timestamp;
      await Promise.allSettled(
        scheduler
          .prioritizeScopes('opensky', candidates)
          .map((candidate) => scheduler.fetch(source, candidate)),
      );
    }

    expect(source.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(source.fetchSnapshot.mock.calls.map(([argument]) => argument.bbox)).toEqual([
      candidates[0]!.bbox,
      candidates[1]!.bbox,
    ]);
  });

  it('keeps the same priority through fresh and stale cache cycles until another upstream starts', async () => {
    let now = 0;
    const source = provider('opensky', async () =>
      snapshot('opensky', new Date(now).toISOString()),
    );
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 1_000, cacheTtlMs: 100, maxBackoffMs: 1_000 } },
      now: () => now,
    });
    const candidates = [scope('a'), scope('b')];

    await Promise.allSettled(
      scheduler
        .prioritizeScopes('opensky', candidates)
        .map((candidate) => scheduler.fetch(source, candidate)),
    );
    expect(scheduler.prioritizeScopes('opensky', candidates)[0]!.cacheKey).toBe('b');
    now = 50;
    await Promise.allSettled(
      scheduler
        .prioritizeScopes('opensky', candidates)
        .map((candidate) => scheduler.fetch(source, candidate)),
    );
    expect(scheduler.prioritizeScopes('opensky', candidates)[0]!.cacheKey).toBe('b');
    now = 500;
    await Promise.allSettled(
      scheduler
        .prioritizeScopes('opensky', candidates)
        .map((candidate) => scheduler.fetch(source, candidate)),
    );
    expect(scheduler.prioritizeScopes('opensky', candidates)[0]!.cacheKey).toBe('b');
    now = 1_000;
    await Promise.allSettled(
      scheduler
        .prioritizeScopes('opensky', candidates)
        .map((candidate) => scheduler.fetch(source, candidate)),
    );
    expect(scheduler.prioritizeScopes('opensky', candidates)[0]!.cacheKey).toBe('a');
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('bounds cached dynamic scopes with LRU eviction while keeping stale fallback entries', async () => {
    let now = 0;
    const source = provider('opensky', async () =>
      snapshot('opensky', new Date(now).toISOString()),
    );
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 0, cacheTtlMs: 10_000, maxBackoffMs: 1_000 } },
      maxCacheEntries: 2,
      now: () => now,
    });

    await scheduler.fetch(source, scope('a'));
    now += 1;
    await scheduler.fetch(source, scope('b'));
    now += 1;
    expect((await scheduler.fetch(source, scope('a'))).source).toBe('cache');
    now += 1;
    await scheduler.fetch(source, scope('c'));

    expect(scheduler.cacheSize()).toBe(2);
    now += 1;
    expect((await scheduler.fetch(source, scope('b'))).source).toBe('upstream');
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(4);
    expect(scheduler.cacheSize()).toBe(2);
  });

  it('does not let an older upstream snapshot replace a newer provider-scope cache entry', async () => {
    let attempt = 0;
    const source = provider('opensky', async () => {
      attempt += 1;
      return snapshot(
        'opensky',
        attempt === 1 ? '2026-07-11T08:01:00.000Z' : '2026-07-11T08:00:00.000Z',
      );
    });
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
      now: () => attempt,
    });

    const first = await scheduler.fetch(source, scope('a'));
    const older = await scheduler.fetch(source, scope('a'));

    expect(older).toMatchObject({
      source: 'upstream',
      upstreamSucceeded: true,
      snapshotAccepted: false,
      snapshot: first.snapshot,
    });
  });

  it('keeps the cache bounded when an older in-flight response finishes after eviction', async () => {
    let attempt = 0;
    let resolveOlder!: (value: ProviderSnapshot) => void;
    const olderPending = new Promise<ProviderSnapshot>((resolve) => {
      resolveOlder = resolve;
    });
    const source = provider('opensky', async () => {
      attempt += 1;
      if (attempt === 1) return snapshot('opensky', '2026-07-11T08:01:00.000Z');
      if (attempt === 2) return olderPending;
      return snapshot('opensky', '2026-07-11T08:02:00.000Z');
    });
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
      maxCacheEntries: 1,
      now: () => attempt,
    });

    await scheduler.fetch(source, scope('a'));
    const older = scheduler.fetch(source, scope('a'));
    await scheduler.fetch(source, scope('b'));
    resolveOlder(snapshot('opensky', '2026-07-11T08:00:00.000Z'));
    await older;

    expect(scheduler.cacheSize()).toBe(1);
  });

  it('validates policies and normalizes the Airplanes.live minimums', () => {
    expect(() =>
      createProviderScheduler({
        policies: { bad: { minIntervalMs: -1, cacheTtlMs: 0, maxBackoffMs: 1 } },
      }),
    ).toThrow();
    expect(
      normalizeProviderPolicy('airplanes-live', {
        minIntervalMs: 1,
        cacheTtlMs: 2,
        maxBackoffMs: 3,
      }),
    ).toEqual({ minIntervalMs: 180_000, cacheTtlMs: 180_000, maxBackoffMs: 3 });
    expect(
      normalizeProviderPolicy('opensky', {
        minIntervalMs: 1,
        cacheTtlMs: 2,
        maxBackoffMs: 3,
      }),
    ).toEqual({ minIntervalMs: 1, cacheTtlMs: 2, maxBackoffMs: 3 });
  });

  it('returns a fresh same-scope cache entry without calling the provider twice', async () => {
    let now = 1_000;
    const source = provider('opensky', async () => snapshot('opensky'));
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 100, cacheTtlMs: 500, maxBackoffMs: 1_000 } },
      now: () => now,
    });

    const first = await scheduler.fetch(source, scope('a'));
    now += 200;
    const cached = await scheduler.fetch(source, scope('a'));
    expect(cached).toMatchObject({ source: 'cache', requestAttempted: false });
    expect(cached.snapshot).toBe(first.snapshot);
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('returns stale same-scope cache while the provider global minimum interval is active', async () => {
    let now = 1_000;
    const source = provider('opensky', async () => snapshot('opensky'));
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 1_000, cacheTtlMs: 100, maxBackoffMs: 2_000 } },
      now: () => now,
    });

    const first = await scheduler.fetch(source, scope('a'));
    now = 1_200;

    const cached = await scheduler.fetch(source, scope('a'));
    expect(cached).toMatchObject({ source: 'stale-cache', requestAttempted: false });
    expect(cached.snapshot).toBe(first.snapshot);
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(scheduler.nextAllowedAt('opensky')).toBe(2_000);
  });

  it('reports whether a snapshot came from upstream, fresh cache, or stale fallback', async () => {
    let now = 1_000;
    const source = provider('opensky', async () => snapshot('opensky'));
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 1_000, cacheTtlMs: 100, maxBackoffMs: 2_000 } },
      now: () => now,
    });

    await expect(scheduler.fetch(source, scope('a'))).resolves.toMatchObject({
      source: 'upstream',
      requestAttempted: true,
      upstreamSucceeded: true,
      snapshot: snapshot('opensky'),
    });
    now = 1_050;
    await expect(scheduler.fetch(source, scope('a'))).resolves.toMatchObject({
      source: 'cache',
      requestAttempted: false,
      upstreamSucceeded: false,
      snapshot: snapshot('opensky'),
    });
    now = 1_200;
    await expect(scheduler.fetch(source, scope('a'))).resolves.toMatchObject({
      source: 'stale-cache',
      requestAttempted: false,
      upstreamSucceeded: false,
      snapshot: snapshot('opensky'),
    });
  });

  it('applies the minimum interval globally across scopes', async () => {
    let now = 1_000;
    const source = provider('opensky', async () => snapshot('opensky'));
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 500, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
      now: () => now,
    });
    await scheduler.fetch(source, scope('a'));

    await expect(scheduler.fetch(source, scope('b'))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 500,
    });
    expect(scheduler.nextAllowedAt('opensky')).toBe(1_500);
    now = 1_500;
    await expect(scheduler.fetch(source, scope('b'))).resolves.toMatchObject({
      source: 'upstream',
      snapshot: snapshot('opensky'),
    });
  });

  it('honors Retry-After and does not cache failures', async () => {
    let now = 10_000;
    const source = provider('opensky', async () => {
      throw new ProviderError('RATE_LIMITED', 'slow down', 4_000);
    });
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 100, cacheTtlMs: 500, maxBackoffMs: 2_000 } },
      now: () => now,
    });

    await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(scheduler.nextAllowedAt('opensky')).toBe(14_000);
    now = 14_000;
    await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('exponentially backs off, caps delays, and resets after success', async () => {
    let now = 0;
    let attempts = 0;
    const source = provider('adsb-lol', async () => {
      attempts += 1;
      if (attempts <= 3 || attempts === 5) throw new ProviderError('UPSTREAM_ERROR', 'down');
      return snapshot('adsb-lol');
    });
    const scheduler = createProviderScheduler({
      policies: { 'adsb-lol': { minIntervalMs: 100, cacheTtlMs: 0, maxBackoffMs: 250 } },
      now: () => now,
    });

    for (const expected of [100, 200, 250]) {
      await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
        code: 'UPSTREAM_ERROR',
      });
      expect(scheduler.nextAllowedAt('adsb-lol')).toBe(now + expected);
      now += expected;
    }
    await scheduler.fetch(source, scope('a'));
    now += 100;
    await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(scheduler.nextAllowedAt('adsb-lol')).toBe(now + 100);
  });

  it('applies failure backoff when a provider throws synchronously', async () => {
    let now = 1_000;
    const source = {
      providerId: 'opensky',
      fetchSnapshot: vi.fn(() => {
        throw new ProviderError('UPSTREAM_ERROR', 'sync failure');
      }),
    } satisfies FlightPositionProvider;
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 100, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
      now: () => now,
    });

    await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(scheduler.nextAllowedAt('opensky')).toBe(1_100);
    await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 100,
    });

    now = 1_100;
    await expect(scheduler.fetch(source, scope('a'))).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(scheduler.nextAllowedAt('opensky')).toBe(1_300);
  });

  it('keeps providers independent and deduplicates concurrent same-key calls', async () => {
    let resolve!: (value: ProviderSnapshot) => void;
    const pending = new Promise<ProviderSnapshot>((done) => {
      resolve = done;
    });
    const first = provider('first', () => pending);
    const second = provider('second', async () => snapshot('second'));
    const scheduler = createProviderScheduler({
      policies: {
        first: { minIntervalMs: 1_000, cacheTtlMs: 1_000, maxBackoffMs: 1_000 },
        second: { minIntervalMs: 1_000, cacheTtlMs: 1_000, maxBackoffMs: 1_000 },
      },
      now: () => 0,
    });

    const one = scheduler.fetch(first, scope('a'));
    const duplicate = scheduler.fetch(first, scope('a'));
    await expect(scheduler.fetch(second, scope('a'))).resolves.toMatchObject({
      source: 'upstream',
      snapshot: snapshot('second'),
    });
    resolve(snapshot('first'));
    expect(await one).toBe(await duplicate);
    expect(first.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('clear resets state and prevents an old in-flight request from repopulating cache', async () => {
    let resolve!: (value: ProviderSnapshot) => void;
    const pending = new Promise<ProviderSnapshot>((done) => {
      resolve = done;
    });
    const source = provider(
      'opensky',
      vi
        .fn()
        .mockImplementationOnce(() => pending)
        .mockResolvedValue(snapshot('opensky', '2026-07-11T08:01:00.000Z')),
    );
    const scheduler = createProviderScheduler({
      policies: { opensky: { minIntervalMs: 100, cacheTtlMs: 1_000, maxBackoffMs: 1_000 } },
      now: () => 0,
    });

    const old = scheduler.fetch(source, scope('a'));
    scheduler.clear();
    expect(scheduler.nextAllowedAt('opensky')).toBeNull();
    resolve(snapshot('opensky'));
    await old;
    await expect(scheduler.fetch(source, scope('a'))).resolves.toMatchObject({
      source: 'upstream',
      snapshot: snapshot('opensky', '2026-07-11T08:01:00.000Z'),
    });
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(2);
  });
});
