import { describe, expect, it, vi } from 'vitest';

import type { FlightPositionProvider } from '@hangban/adapters';
import type { Flight, SourceStatus } from '@hangban/contracts';
import { createProviderScheduler } from '@hangban/ingestion';

import { startLiveIngestion } from './live-ingestion';
import { createMemoryRepository } from './memory-repository';
import { createRealtimeHub } from './realtime/hub';

const observedAt = '2026-07-12T08:00:00.000Z';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function provider(
  providerId = 'adsb-lol',
  fetchSnapshot: FlightPositionProvider['fetchSnapshot'] = async () => ({
    providerId,
    observedAt,
    flights: [
      {
        providerId,
        icao24: 'abc123',
        callsign: 'CA981',
        latitude: 40,
        longitude: 116,
        altitudeM: 9_000,
        groundSpeedKmh: 800,
        headingDeg: 90,
        verticalRateMpm: 0,
        observedAt,
      },
    ],
  }),
): FlightPositionProvider {
  return { providerId, fetchSnapshot };
}

function scheduler(providerId = 'adsb-lol') {
  return createProviderScheduler({
    policies: {
      [providerId]: { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 },
    },
    now: () => Date.parse(observedAt),
  });
}

function repository(seed?: { flights?: Flight[]; statuses?: SourceStatus[] }) {
  return createMemoryRepository({
    airports: [],
    flights: seed?.flights ?? [],
    sourceStatuses: seed?.statuses ?? [],
  });
}

describe('live ingestion controller', () => {
  it('uses current active viewports for every cycle and atomically stores its result', async () => {
    const repo = repository();
    const replaceSnapshot = vi.spyOn(repo, 'replaceSnapshot');
    const replaceFlights = vi.spyOn(repo, 'replaceFlights');
    const replaceSourceStatuses = vi.spyOn(repo, 'replaceSourceStatuses');
    const hub = createRealtimeHub();
    const source = provider();
    const fetchSpy = vi.spyOn(source, 'fetchSnapshot');
    hub.subscribe('a', [100, 20, 130, 50]);

    const controller = startLiveIngestion({
      repository: repo,
      hub,
      providers: [source],
      scheduler: scheduler(),
      defaultBboxes: [[-10, 30, 10, 50]],
      intervalMs: 10_000,
      now: () => new Date(observedAt),
    });
    await controller.runNow();

    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy.mock.calls.some(([scope]) => scope.bbox[0] === 100)).toBe(true);
    expect(repo.allFlights()).toEqual([
      expect.objectContaining({ callsign: 'CA981', sources: ['adsb-lol'] }),
    ]);
    expect(repo.sourceStatuses()).toEqual([
      expect.objectContaining({ providerId: 'adsb-lol', state: 'healthy' }),
    ]);
    expect(replaceSnapshot).toHaveBeenCalledTimes(1);
    expect(replaceFlights).not.toHaveBeenCalled();
    expect(replaceSourceStatuses).not.toHaveBeenCalled();

    hub.unsubscribe('a');
    hub.subscribe('b', [-90, 30, -60, 50]);
    await controller.runNow();
    expect(fetchSpy.mock.calls.some(([scope]) => scope.bbox[0] === -90)).toBe(true);
    controller.stop();
  });

  it('falls back to default viewports and makes no requests when both viewport sets are empty', async () => {
    const source = provider();
    const fetchSpy = vi.spyOn(source, 'fetchSnapshot');
    const defaultController = startLiveIngestion({
      repository: repository(),
      hub: createRealtimeHub(),
      providers: [source],
      scheduler: scheduler(),
      defaultBboxes: [[-10, 30, 10, 50]],
      intervalMs: 10_000,
      now: () => new Date(observedAt),
    });
    await defaultController.runNow();
    expect(fetchSpy.mock.calls.some(([scope]) => scope.bbox[0] === -10)).toBe(true);
    defaultController.stop();

    fetchSpy.mockClear();
    const emptyController = startLiveIngestion({
      repository: repository(),
      hub: createRealtimeHub(),
      providers: [source],
      scheduler: scheduler(),
      defaultBboxes: [],
      intervalMs: 10_000,
      now: () => new Date(observedAt),
    });
    await emptyController.runNow();
    expect(fetchSpy).not.toHaveBeenCalled();
    emptyController.stop();
  });

  it('coalesces concurrent runNow calls and does not write an in-flight result after stop', async () => {
    const result = deferred<Awaited<ReturnType<FlightPositionProvider['fetchSnapshot']>>>();
    const source = provider(
      'adsb-lol',
      vi.fn(() => result.promise),
    );
    const repo = repository();
    const controller = startLiveIngestion({
      repository: repo,
      hub: createRealtimeHub(),
      providers: [source],
      scheduler: scheduler(),
      defaultBboxes: [[100, 20, 105, 25]],
      intervalMs: 10_000,
      now: () => new Date(observedAt),
    });

    const first = controller.runNow();
    const second = controller.runNow();
    await Promise.resolve();
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(1);
    controller.stop();
    result.resolve({ providerId: 'adsb-lol', observedAt, flights: [] });
    await Promise.all([first, second]);
    expect(repo.sourceStatuses()).toEqual([]);
    await controller.runNow();
    expect(source.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate providers before starting a timer', () => {
    expect(() =>
      startLiveIngestion({
        repository: repository(),
        hub: createRealtimeHub(),
        providers: [provider(), provider()],
        scheduler: scheduler(),
        defaultBboxes: [],
        intervalMs: 10_000,
      }),
    ).toThrow(/Duplicate provider ID/);
  });

  it('owns and clears its interval without leaking rejected timer cycles', async () => {
    vi.useFakeTimers();
    const source = provider('adsb-lol', async () => {
      throw new Error('secret upstream detail');
    });
    const controller = startLiveIngestion({
      repository: repository(),
      hub: createRealtimeHub(),
      providers: [source],
      scheduler: scheduler(),
      defaultBboxes: [[100, 20, 105, 25]],
      intervalMs: 1_000,
      now: () => new Date(observedAt),
    });

    await vi.advanceTimersByTimeAsync(1_000);
    controller.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
