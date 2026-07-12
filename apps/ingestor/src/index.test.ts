import type { FlightPositionProvider } from '@hangban/adapters';
import { createProviderScheduler, type CollectionScope } from '@hangban/ingestion';
import { describe, expect, it, vi } from 'vitest';

import { runCli, runIngestorOnce, startIngestorPolling, writeJsonLine } from './index';

const now = new Date('2026-07-12T08:00:00.000Z');
const scope: CollectionScope = {
  bbox: [115, 35, 120, 40],
  latitude: 37.5,
  longitude: 117.5,
  radiusNm: 212,
  cacheKey: 'cell:115,35,120,40',
};

function scheduler(...providerIds: string[]) {
  return createProviderScheduler({
    policies: Object.fromEntries(
      providerIds.map((providerId) => [
        providerId,
        { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 },
      ]),
    ),
    now: () => now,
  });
}

describe('runIngestorOnce', () => {
  it('returns a stable cycle summary without exposing provider payloads', async () => {
    const provider: FlightPositionProvider = {
      providerId: 'adsb-lol',
      async fetchSnapshot() {
        return {
          providerId: 'adsb-lol',
          observedAt: now.toISOString(),
          flights: [
            {
              providerId: 'adsb-lol',
              icao24: '780001',
              callsign: 'CA981',
              latitude: 39.9,
              longitude: 116.4,
              observedAt: now.toISOString(),
            },
          ],
        };
      },
    };

    const summary = await runIngestorOnce({
      providers: [provider],
      scopes: [scope],
      scheduler: scheduler('adsb-lol'),
      now: () => now,
    });

    expect(summary).toEqual({
      event: 'ingestion.cycle',
      observedAt: now.toISOString(),
      flights: 1,
      providers: [{ providerId: 'adsb-lol', state: 'healthy', records: 1 }],
    });
    expect(JSON.stringify(summary)).not.toContain('CA981');
  });
});

describe('startIngestorPolling', () => {
  it('runs immediately, never overlaps cycles, and stops cleanly', async () => {
    let releaseFirst: (() => void) | undefined;
    const runOnce = vi
      .fn<() => Promise<{ event: 'ingestion.cycle' }>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve({ event: 'ingestion.cycle' });
          }),
      )
      .mockResolvedValue({ event: 'ingestion.cycle' });
    const callbacks: Array<() => void> = [];
    const clearInterval = vi.fn();
    const writeSummary = vi.fn();

    const controller = startIngestorPolling({
      intervalMs: 1_000,
      runOnce,
      writeSummary,
      timers: {
        setInterval(callback) {
          callbacks.push(callback);
          return 7 as unknown as ReturnType<typeof setInterval>;
        },
        clearInterval,
      },
    });
    await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);

    callbacks[0]!();
    callbacks[0]!();
    await Promise.resolve();
    expect(runOnce).toHaveBeenCalledTimes(1);

    releaseFirst!();
    await controller.currentCycle();
    expect(writeSummary).toHaveBeenCalledTimes(1);
    callbacks[0]!();
    await controller.currentCycle();
    expect(runOnce).toHaveBeenCalledTimes(2);

    controller.stop();
    callbacks[0]!();
    await Promise.resolve();
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('keeps the cycle in flight until an asynchronous summary writer drains', async () => {
    let releaseWrite: (() => void) | undefined;
    const writeSummary = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    const runOnce = vi.fn().mockResolvedValue({ event: 'ingestion.cycle' });
    const callbacks: Array<() => void> = [];
    const controller = startIngestorPolling({
      intervalMs: 1_000,
      runOnce,
      writeSummary,
      timers: {
        setInterval(callback) {
          callbacks.push(callback);
          return 8 as unknown as ReturnType<typeof setInterval>;
        },
        clearInterval: vi.fn(),
      },
    });
    await vi.waitFor(() => expect(writeSummary).toHaveBeenCalledOnce());

    callbacks[0]!();
    callbacks[0]!();
    await Promise.resolve();
    expect(runOnce).toHaveBeenCalledOnce();

    releaseWrite!();
    await controller.currentCycle();
    callbacks[0]!();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(2));
    controller.stop();
  });

  it('contains rejected asynchronous writers without an unhandled rejection', async () => {
    const writeError = vi.fn().mockRejectedValue(new Error('stderr closed with secret'));
    const controller = startIngestorPolling({
      intervalMs: 1_000,
      runOnce: vi.fn().mockResolvedValue({ event: 'ingestion.cycle' }),
      writeSummary: vi.fn().mockRejectedValue(new Error('stdout closed with secret')),
      writeError,
    });

    await expect(controller.currentCycle()).resolves.toBeUndefined();
    controller.stop();
    expect(writeError).toHaveBeenCalledWith({
      event: 'ingestion.cycle.failed',
      code: 'INGESTION_CYCLE_FAILED',
    });
  });

  it('contains rejected cycles and reports a stable error instead of leaking details', async () => {
    const writeError = vi.fn();
    const controller = startIngestorPolling({
      intervalMs: 1_000,
      runOnce: async () => {
        throw new Error('https://provider.invalid?secret=do-not-log');
      },
      writeSummary: vi.fn(),
      writeError,
    });

    await controller.currentCycle();
    controller.stop();
    expect(writeError).toHaveBeenCalledWith({
      event: 'ingestion.cycle.failed',
      code: 'INGESTION_CYCLE_FAILED',
    });
    expect(JSON.stringify(writeError.mock.calls)).not.toContain('do-not-log');
  });
});

describe('writeJsonLine', () => {
  it('waits for drain on backpressure and removes all temporary listeners', async () => {
    const writable = new EventEmitter() as EventEmitter & { write(value: string): boolean };
    writable.write = vi.fn().mockReturnValue(false);

    const pending = writeJsonLine({ ok: true }, writable);
    expect(writable.write).toHaveBeenCalledWith('{"ok":true}\n');
    expect(writable.listenerCount('drain')).toBe(1);
    writable.emit('drain');
    await expect(pending).resolves.toBeUndefined();
    expect(writable.eventNames()).toEqual([]);
  });

  it.each(['error', 'close'] as const)('rejects on %s and removes all listeners', async (event) => {
    const writable = new EventEmitter() as EventEmitter & { write(value: string): boolean };
    writable.write = vi.fn().mockReturnValue(false);
    const pending = writeJsonLine({ ok: false }, writable);
    if (event === 'error') writable.emit(event, new Error('stream failed'));
    else writable.emit(event);
    await expect(pending).rejects.toThrow();
    expect(writable.eventNames()).toEqual([]);
  });
});

describe('runCli lifecycle', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'stops continuous mode on %s and removes both signal listeners',
    async (signalName) => {
      const signals = new EventEmitter();
      const writeSummary = vi.fn().mockResolvedValue(undefined);
      const running = runCli({ DATA_MODE: 'demo', INGEST_INTERVAL_MS: '1000' }, ['--continuous'], {
        signals,
        writeSummary,
        writeError: vi.fn(),
      });
      await vi.waitFor(() => expect(writeSummary).toHaveBeenCalledOnce());
      signals.emit(signalName);
      await running;
      expect(signals.listenerCount('SIGINT')).toBe(0);
      expect(signals.listenerCount('SIGTERM')).toBe(0);
    },
  );

  it('writes exactly one summary in single-run mode', async () => {
    const writeSummary = vi.fn().mockResolvedValue(undefined);
    await runCli({ DATA_MODE: 'demo' }, [], { writeSummary, writeError: vi.fn() });
    expect(writeSummary).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight summary writer after a termination signal', async () => {
    const signals = new EventEmitter();
    let releaseWrite: (() => void) | undefined;
    const writeSummary = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    let finished = false;
    const running = runCli({ DATA_MODE: 'demo', INGEST_INTERVAL_MS: '1000' }, ['--continuous'], {
      signals,
      writeSummary,
      writeError: vi.fn(),
    }).then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(writeSummary).toHaveBeenCalledOnce());
    signals.emit('SIGTERM');
    await Promise.resolve();
    expect(finished).toBe(false);
    releaseWrite!();
    await running;
    expect(finished).toBe(true);
  });
});
import { EventEmitter } from 'node:events';
