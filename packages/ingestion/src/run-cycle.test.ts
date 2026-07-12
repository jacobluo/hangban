import { ProviderError, type FlightPositionProvider } from '@hangban/adapters';
import type { Flight, SourceStatus } from '@hangban/contracts';
import { createProviderScheduler } from './provider-scheduler';
import type { CollectionScope } from './scope-planner';
import { describe, expect, it, vi } from 'vitest';

import { runCycle } from './run-cycle';

const cycleTime = new Date('2026-07-11T08:03:00.000Z');
const observedAt = '2026-07-11T08:02:55.000Z';
const scopes: CollectionScope[] = [
  { bbox: [100, 20, 101, 21], latitude: 20.5, longitude: 100.5, radiusNm: 42, cacheKey: 'a' },
  { bbox: [101, 20, 102, 21], latitude: 20.5, longitude: 101.5, radiusNm: 42, cacheKey: 'b' },
];

const oldFlight: Flight = {
  id: 'icao-780001',
  icao24: '780001',
  callsign: 'CA981',
  latitude: 40,
  longitude: 116,
  altitudeM: 10_000,
  groundSpeedKmh: 800,
  headingDeg: 68,
  verticalRateMpm: 0,
  observedAt: '2026-07-11T08:00:00.000Z',
  freshness: 'live',
  confidence: 0.75,
  sources: ['healthy'],
  inferredFields: [],
  fieldSources: [],
};

const healthyStatus: SourceStatus = {
  providerId: 'failed',
  state: 'healthy',
  lastAttemptAt: '2026-07-11T08:00:00.000Z',
  lastSuccessAt: '2026-07-11T08:00:00.000Z',
  lastRecordCount: 1,
};

function scheduler(...providerIds: string[]) {
  return createProviderScheduler({
    policies: Object.fromEntries(
      providerIds.map((providerId) => [
        providerId,
        { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 },
      ]),
    ),
    now: () => cycleTime,
  });
}

function flight(providerId: string, icao24: string, longitude = 116) {
  return {
    providerId,
    icao24,
    callsign: `C${icao24}`,
    latitude: 40,
    longitude,
    altitudeM: 10_000,
    groundSpeedKmh: 800,
    headingDeg: 68,
    verticalRateMpm: 0,
    observedAt,
  };
}

describe('runCycle', () => {
  it('preserves enriched metadata when a newer position snapshot omits it', async () => {
    const enriched = {
      ...oldFlight,
      airline: 'Air China',
      registration: 'B-2482',
      fieldSources: [
        {
          field: 'registration' as const,
          providerId: 'adsbdb',
          observedAt: oldFlight.observedAt,
          inferred: false,
          confidence: 0.9,
        },
      ],
    };
    const provider: FlightPositionProvider = {
      providerId: 'healthy',
      fetchSnapshot: async () => ({
        providerId: 'healthy',
        observedAt,
        flights: [flight('healthy', '780001')],
      }),
    };
    const result = await runCycle({
      providers: [provider],
      scopes: [scopes[0]!],
      previousFlights: [enriched],
      previousStatuses: [healthyStatus],
      scheduler: scheduler('healthy'),
      now: () => cycleTime,
    });
    expect(result.flights[0]).toMatchObject({
      airline: 'Air China',
      registration: 'B-2482',
      latitude: 40,
      fieldSources: [expect.objectContaining({ providerId: 'adsbdb' })],
    });
  });
  it('preserves flights and statuses when no providers are enabled', async () => {
    const result = await runCycle({
      providers: [],
      scopes: [scopes[0]!],
      previousFlights: [oldFlight],
      previousStatuses: [healthyStatus],
      scheduler: scheduler(),
      now: () => cycleTime,
    });

    expect(result.successfulProviders).toBe(0);
    expect(result.flights).toEqual([{ ...oldFlight, freshness: 'stale' }]);
    expect(result.statuses).toEqual([healthyStatus]);
  });

  it('rejects duplicate provider IDs before scheduling work', async () => {
    const duplicate: FlightPositionProvider = {
      providerId: 'duplicate',
      fetchSnapshot: vi.fn(),
    };

    await expect(
      runCycle({
        providers: [duplicate, duplicate],
        scopes: [scopes[0]!],
        previousFlights: [],
        previousStatuses: [],
        scheduler: scheduler('duplicate'),
        now: () => cycleTime,
      }),
    ).rejects.toThrow('Duplicate provider ID: duplicate');
    expect(duplicate.fetchSnapshot).not.toHaveBeenCalled();
  });

  it('does not degrade a provider when non-attempted scopes are locally deferred', async () => {
    const provider: FlightPositionProvider = {
      providerId: 'limited',
      async fetchSnapshot() {
        return {
          providerId: 'limited',
          observedAt,
          flights: [flight('limited', '780009')],
        };
      },
    };
    const result = await runCycle({
      providers: [provider],
      scopes,
      previousFlights: [],
      previousStatuses: [],
      scheduler: createProviderScheduler({
        policies: { limited: { minIntervalMs: 1_000, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
        now: () => cycleTime,
      }),
      now: () => cycleTime,
    });

    expect(result.successfulProviders).toBe(1);
    expect(result.statuses).toEqual([
      {
        providerId: 'limited',
        state: 'healthy',
        lastAttemptAt: cycleTime.toISOString(),
        lastSuccessAt: observedAt,
        lastRecordCount: 1,
      },
    ]);
  });

  it('does not regress a flight position or lastSuccessAt when a later cycle observes older data', async () => {
    let clock = new Date('2026-07-11T08:02:00.000Z');
    let attempt = 0;
    const provider: FlightPositionProvider = {
      providerId: 'unordered',
      async fetchSnapshot() {
        attempt += 1;
        const currentObservedAt =
          attempt === 1 ? '2026-07-11T08:02:00.000Z' : '2026-07-11T08:01:00.000Z';
        return {
          providerId: 'unordered',
          observedAt: currentObservedAt,
          flights: [
            {
              ...flight('unordered', '780010', attempt === 1 ? 120 : 110),
              observedAt: currentObservedAt,
            },
          ],
        };
      },
    };
    const cycleScheduler = createProviderScheduler({
      policies: { unordered: { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
      now: () => clock,
    });
    const first = await runCycle({
      providers: [provider],
      scopes: [scopes[0]!],
      previousFlights: [],
      previousStatuses: [],
      scheduler: cycleScheduler,
      now: () => clock,
    });

    clock = new Date('2026-07-11T08:03:00.000Z');
    const second = await runCycle({
      providers: [provider],
      scopes: [scopes[1]!],
      previousFlights: first.flights,
      previousStatuses: first.statuses,
      scheduler: cycleScheduler,
      now: () => clock,
    });

    expect(second.flights[0]).toMatchObject({
      id: first.flights[0]!.id,
      longitude: 120,
      observedAt: '2026-07-11T08:02:00.000Z',
      freshness: 'delayed',
    });
    expect(second.statuses[0]).toMatchObject({
      state: 'healthy',
      lastAttemptAt: '2026-07-11T08:03:00.000Z',
      lastSuccessAt: '2026-07-11T08:02:00.000Z',
    });
    expect(second.statuses[0]).not.toHaveProperty('errorCode');
  });

  it('accepts a first snapshot for a new scope even when its observedAt predates the provider global success', async () => {
    const clock = new Date('2026-07-11T08:03:00.000Z');
    const provider: FlightPositionProvider = {
      providerId: 'multi-region',
      async fetchSnapshot() {
        return {
          providerId: 'multi-region',
          observedAt: '2026-07-11T08:01:00.000Z',
          flights: [
            {
              ...flight('multi-region', '780011'),
              observedAt: '2026-07-11T08:01:00.000Z',
            },
          ],
        };
      },
    };
    const result = await runCycle({
      providers: [provider],
      scopes: [scopes[1]!],
      previousFlights: [],
      previousStatuses: [
        {
          providerId: 'multi-region',
          state: 'healthy',
          lastAttemptAt: '2026-07-11T08:02:00.000Z',
          lastSuccessAt: '2026-07-11T08:02:00.000Z',
          lastRecordCount: 1,
        },
      ],
      scheduler: createProviderScheduler({
        policies: { 'multi-region': { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 } },
        now: () => clock,
      }),
      now: () => clock,
    });

    expect(result.statuses[0]).toMatchObject({
      state: 'healthy',
      lastSuccessAt: '2026-07-11T08:02:00.000Z',
    });
    expect(result.statuses[0]).not.toHaveProperty('errorCode');
  });

  it('does not treat stale cache fallback as recovery after an upstream failure', async () => {
    let clock = new Date('2026-07-11T08:00:00.000Z');
    let upstreamAttempt = 0;
    const provider: FlightPositionProvider = {
      providerId: 'sequenced',
      async fetchSnapshot() {
        upstreamAttempt += 1;
        if (upstreamAttempt === 2) throw new ProviderError('TIMEOUT', 'timed out');
        return {
          providerId: 'sequenced',
          observedAt: clock.toISOString(),
          flights: [flight('sequenced', '780005')],
        };
      },
    };
    const cycleScheduler = createProviderScheduler({
      policies: { sequenced: { minIntervalMs: 1_000, cacheTtlMs: 100, maxBackoffMs: 1_000 } },
      now: () => clock,
    });
    const run = (previousFlights: Flight[], previousStatuses: SourceStatus[]) =>
      runCycle({
        providers: [provider],
        scopes: [scopes[0]!],
        previousFlights,
        previousStatuses,
        scheduler: cycleScheduler,
        now: () => clock,
      });

    const first = await run([], []);
    expect(first.successfulProviders).toBe(1);
    expect(first.statuses[0]).toMatchObject({
      state: 'healthy',
      lastAttemptAt: '2026-07-11T08:00:00.000Z',
      lastSuccessAt: '2026-07-11T08:00:00.000Z',
    });

    clock = new Date('2026-07-11T08:00:01.000Z');
    const failed = await run(first.flights, first.statuses);
    expect(failed.successfulProviders).toBe(0);
    expect(failed.statuses[0]).toMatchObject({
      state: 'degraded',
      errorCode: 'TIMEOUT',
      lastAttemptAt: '2026-07-11T08:00:01.000Z',
      lastSuccessAt: '2026-07-11T08:00:00.000Z',
    });

    clock = new Date('2026-07-11T08:00:01.100Z');
    const staleFallback = await run(failed.flights, failed.statuses);
    expect(staleFallback.successfulProviders).toBe(0);
    expect(staleFallback.flights).toEqual(
      failed.flights.map((item) => ({ ...item, freshness: 'live' })),
    );
    expect(staleFallback.statuses).toEqual(failed.statuses);

    clock = new Date('2026-07-11T08:00:02.000Z');
    const recovered = await run(staleFallback.flights, staleFallback.statuses);
    expect(recovered.successfulProviders).toBe(1);
    expect(recovered.statuses[0]).toEqual({
      providerId: 'sequenced',
      state: 'healthy',
      lastAttemptAt: '2026-07-11T08:00:02.000Z',
      lastSuccessAt: '2026-07-11T08:00:02.000Z',
      lastRecordCount: 1,
    });
  });

  it('preserves the complete previous snapshot when stale cache covers one scope and another scope is deferred', async () => {
    let clock = new Date('2026-07-11T08:00:00.000Z');
    let attempts = 0;
    const provider: FlightPositionProvider = {
      providerId: 'regional',
      async fetchSnapshot() {
        attempts += 1;
        if (attempts > 1) throw new ProviderError('UPSTREAM_ERROR', 'offline');
        return {
          providerId: 'regional',
          observedAt: clock.toISOString(),
          flights: [flight('regional', '780006')],
        };
      },
    };
    const cycleScheduler = createProviderScheduler({
      policies: { regional: { minIntervalMs: 1_000, cacheTtlMs: 100, maxBackoffMs: 1_000 } },
      now: () => clock,
    });
    const first = await runCycle({
      providers: [provider],
      scopes: [scopes[0]!],
      previousFlights: [],
      previousStatuses: [],
      scheduler: cycleScheduler,
      now: () => clock,
    });
    const completePrevious = [first.flights[0]!, oldFlight];

    clock = new Date('2026-07-11T08:00:01.000Z');
    const failed = await runCycle({
      providers: [provider],
      scopes,
      previousFlights: completePrevious,
      previousStatuses: first.statuses,
      scheduler: cycleScheduler,
      now: () => clock,
    });
    clock = new Date('2026-07-11T08:00:01.100Z');
    const fallback = await runCycle({
      providers: [provider],
      scopes,
      previousFlights: failed.flights,
      previousStatuses: failed.statuses,
      scheduler: cycleScheduler,
      now: () => clock,
    });

    expect(fallback.successfulProviders).toBe(0);
    expect(fallback.flights.map(({ id }) => id)).toEqual(completePrevious.map(({ id }) => id));
    expect(fallback.statuses).toEqual(failed.statuses);
  });

  it('keeps status timestamps and the complete snapshot unchanged on an ordinary fresh cache hit', async () => {
    let clock = new Date('2026-07-11T08:00:00.000Z');
    const provider: FlightPositionProvider = {
      providerId: 'cached',
      async fetchSnapshot() {
        return {
          providerId: 'cached',
          observedAt: clock.toISOString(),
          flights: [flight('cached', '780007')],
        };
      },
    };
    const cycleScheduler = createProviderScheduler({
      policies: { cached: { minIntervalMs: 1_000, cacheTtlMs: 500, maxBackoffMs: 1_000 } },
      now: () => clock,
    });
    const first = await runCycle({
      providers: [provider],
      scopes: [scopes[0]!],
      previousFlights: [],
      previousStatuses: [],
      scheduler: cycleScheduler,
      now: () => clock,
    });
    const completePrevious = [...first.flights, oldFlight];

    clock = new Date('2026-07-11T08:00:00.050Z');
    const cached = await runCycle({
      providers: [provider],
      scopes: [scopes[0]!],
      previousFlights: completePrevious,
      previousStatuses: first.statuses,
      scheduler: cycleScheduler,
      now: () => clock,
    });

    expect(cached.successfulProviders).toBe(0);
    expect(cached.flights).toEqual(completePrevious);
    expect(cached.statuses).toEqual(first.statuses);
  });

  it('keeps previous flights and recalculates freshness when all providers fail', async () => {
    const failingProvider: FlightPositionProvider = {
      providerId: 'failed',
      async fetchSnapshot() {
        throw new ProviderError('UPSTREAM_ERROR', 'private upstream details');
      },
    };

    const result = await runCycle({
      providers: [failingProvider],
      scopes: [scopes[0]!],
      previousFlights: [oldFlight],
      previousStatuses: [healthyStatus],
      scheduler: scheduler('failed'),
      now: () => cycleTime,
    });

    expect(result).toMatchObject({
      observedAt: cycleTime.toISOString(),
      successfulProviders: 0,
      flights: [{ id: oldFlight.id, freshness: 'stale' }],
    });
    expect(result.statuses[0]).toMatchObject({
      providerId: 'failed',
      state: 'down',
      lastAttemptAt: cycleTime.toISOString(),
      lastSuccessAt: healthyStatus.lastSuccessAt,
      lastRecordCount: healthyStatus.lastRecordCount,
      errorCode: 'UPSTREAM_ERROR',
      message: '数据源暂时不可用',
    });
  });

  it('uses successful provider candidates and reports another provider as degraded while cached data is recent', async () => {
    const healthy: FlightPositionProvider = {
      providerId: 'healthy',
      async fetchSnapshot() {
        return { providerId: 'healthy', observedAt, flights: [flight('healthy', '780002')] };
      },
    };
    const failed: FlightPositionProvider = {
      providerId: 'failed',
      async fetchSnapshot() {
        throw new ProviderError('TIMEOUT', 'timed out');
      },
    };

    const result = await runCycle({
      providers: [healthy, failed],
      scopes: [scopes[0]!],
      previousFlights: [oldFlight],
      previousStatuses: [{ ...healthyStatus, lastSuccessAt: '2026-07-11T08:02:30.000Z' }],
      scheduler: scheduler('healthy', 'failed'),
      now: () => cycleTime,
    });

    expect(result.flights).toHaveLength(1);
    expect(result.flights[0]?.icao24).toBe('780002');
    expect(result.successfulProviders).toBe(1);
    expect(result.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'healthy', state: 'healthy', lastRecordCount: 1 }),
        expect.objectContaining({ providerId: 'failed', state: 'degraded', errorCode: 'TIMEOUT' }),
      ]),
    );
  });

  it('aggregates multiple scopes per provider, deduplicates flights, and degrades partial scope failure', async () => {
    const provider: FlightPositionProvider = {
      providerId: 'mixed',
      fetchSnapshot: vi.fn(async ({ bbox }) => {
        if (bbox[0] === 101) throw new ProviderError('RATE_LIMITED', 'quota', 500);
        return {
          providerId: 'mixed',
          observedAt,
          flights: [flight('mixed', '780003'), { ...flight('mixed', 'badbad'), latitude: 999 }],
        };
      }),
    };

    const result = await runCycle({
      providers: [provider],
      scopes,
      previousFlights: [],
      previousStatuses: [],
      scheduler: scheduler('mixed'),
      now: () => cycleTime,
    });

    expect(provider.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(result.flights.map(({ icao24 }) => icao24)).toEqual(['780003']);
    expect(result.successfulProviders).toBe(1);
    expect(result.statuses).toEqual([
      expect.objectContaining({
        providerId: 'mixed',
        state: 'degraded',
        lastSuccessAt: observedAt,
        lastRecordCount: 1,
        errorCode: 'RATE_LIMITED',
      }),
    ]);
  });

  it('clears errors and degraded messages after a provider recovers', async () => {
    const provider: FlightPositionProvider = {
      providerId: 'recovering',
      async fetchSnapshot() {
        return {
          providerId: 'recovering',
          observedAt,
          flights: [flight('recovering', '780004')],
        };
      },
    };

    const result = await runCycle({
      providers: [provider],
      scopes: [scopes[0]!],
      previousFlights: [],
      previousStatuses: [
        {
          providerId: 'recovering',
          state: 'down',
          lastAttemptAt: '2026-07-11T08:02:00.000Z',
          lastSuccessAt: null,
          errorCode: 'AUTH_FAILED',
          message: '数据源认证失败',
        },
      ],
      scheduler: scheduler('recovering'),
      now: () => cycleTime,
    });

    expect(result.statuses).toEqual([
      {
        providerId: 'recovering',
        state: 'healthy',
        lastAttemptAt: cycleTime.toISOString(),
        lastSuccessAt: observedAt,
        lastRecordCount: 1,
      },
    ]);
  });

  it('does not attempt providers or discard the previous snapshot when scopes are empty', async () => {
    const provider: FlightPositionProvider = {
      providerId: 'idle',
      fetchSnapshot: vi.fn(),
    };
    const previousStatus: SourceStatus = {
      providerId: 'idle',
      state: 'healthy',
      lastSuccessAt: observedAt,
    };

    const result = await runCycle({
      providers: [provider],
      scopes: [],
      previousFlights: [oldFlight],
      previousStatuses: [previousStatus],
      scheduler: scheduler('idle'),
      now: () => cycleTime,
    });

    expect(provider.fetchSnapshot).not.toHaveBeenCalled();
    expect(result.successfulProviders).toBe(0);
    expect(result.flights[0]).toMatchObject({ id: oldFlight.id, freshness: 'stale' });
    expect(result.statuses).toEqual([previousStatus]);
  });
});
