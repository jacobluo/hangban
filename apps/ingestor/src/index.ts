import { pathToFileURL } from 'node:url';

import { createLiveProviders, type FlightPositionProvider } from '@hangban/adapters';
import { loadConfig } from '@hangban/config';
import type { Flight, SourceStatus } from '@hangban/contracts';
import {
  createProviderScheduler,
  planScopes,
  runCycle,
  type CollectionScope,
  type ProviderScheduler,
} from '@hangban/ingestion';

export type IngestorCycleSummary = {
  event: 'ingestion.cycle';
  observedAt: string;
  flights: number;
  providers: Array<{
    providerId: string;
    state: SourceStatus['state'];
    records: number;
    errorCode?: SourceStatus['errorCode'];
  }>;
};

export type IngestorState = {
  flights: Flight[];
  statuses: SourceStatus[];
};

export async function runIngestorOnce({
  providers,
  scopes,
  scheduler,
  state = { flights: [], statuses: [] },
  now = () => new Date(),
}: {
  providers: FlightPositionProvider[];
  scopes: CollectionScope[];
  scheduler: ProviderScheduler;
  state?: IngestorState;
  now?: () => Date;
}): Promise<IngestorCycleSummary> {
  const result = await runCycle({
    providers,
    scopes,
    previousFlights: state.flights,
    previousStatuses: state.statuses,
    scheduler,
    now,
  });
  state.flights = result.flights;
  state.statuses = result.statuses;
  return {
    event: 'ingestion.cycle',
    observedAt: result.observedAt,
    flights: result.flights.length,
    providers: result.statuses.map((status) => ({
      providerId: status.providerId,
      state: status.state,
      records: status.lastRecordCount ?? 0,
      ...(status.errorCode === undefined ? {} : { errorCode: status.errorCode }),
    })),
  };
}

type TimerHandle = ReturnType<typeof setInterval>;
type TimerApi = {
  setInterval(callback: () => void, intervalMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

type SignalApi = {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
};

export type WritableLike = {
  write(value: string): boolean;
  once(event: 'drain' | 'error' | 'close', listener: (...args: unknown[]) => void): unknown;
  removeListener(
    event: 'drain' | 'error' | 'close',
    listener: (...args: unknown[]) => void,
  ): unknown;
};

export type IngestorPollingController = {
  currentCycle(): Promise<void>;
  stop(): void;
};

export function startIngestorPolling<T>({
  intervalMs,
  runOnce,
  writeSummary,
  writeError = () => undefined,
  timers = { setInterval, clearInterval },
  signal,
}: {
  intervalMs: number;
  runOnce: () => Promise<T>;
  writeSummary: (summary: T) => void | Promise<void>;
  writeError?: (error: {
    event: 'ingestion.cycle.failed';
    code: 'INGESTION_CYCLE_FAILED';
  }) => void | Promise<void>;
  timers?: TimerApi;
  signal?: AbortSignal;
}): IngestorPollingController {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('intervalMs must be positive');
  }
  let stopped = false;
  let inFlight: Promise<void> | undefined;

  const trigger = (): void => {
    if (stopped || inFlight !== undefined) return;
    const cycle = (async () => {
      try {
        await writeSummary(await runOnce());
      } catch {
        try {
          await writeError({
            event: 'ingestion.cycle.failed',
            code: 'INGESTION_CYCLE_FAILED',
          });
        } catch {
          // A closed output stream must not create an unhandled rejection or restart the cycle.
        }
      }
    })();
    inFlight = cycle.finally(() => {
      if (inFlight === wrapped) inFlight = undefined;
    });
    const wrapped = inFlight;
  };

  const timer = timers.setInterval(trigger, intervalMs);
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    timers.clearInterval(timer);
    signal?.removeEventListener('abort', stop);
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  else trigger();

  return {
    currentCycle: () => inFlight ?? Promise.resolve(),
    stop,
  };
}

export function writeJsonLine(
  value: unknown,
  writable: WritableLike = process.stdout,
): Promise<void> {
  const line = `${JSON.stringify(value)}\n`;
  if (writable.write(line)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      writable.removeListener('drain', onDrain);
      writable.removeListener('error', onError);
      writable.removeListener('close', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error('Writable stream failed'));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Writable stream closed before drain'));
    };
    writable.once('drain', onDrain);
    writable.once('error', onError);
    writable.once('close', onClose);
  });
}

export function writeJsonError(
  value: unknown,
  writable: WritableLike = process.stderr,
): Promise<void> {
  return writeJsonLine(value, writable);
}

export async function runCli(
  environment: Record<string, string | undefined> = process.env,
  args: readonly string[] = process.argv.slice(2),
  dependencies: {
    signals?: SignalApi;
    writeSummary?: (summary: IngestorCycleSummary) => void | Promise<void>;
    writeError?: (error: unknown) => void | Promise<void>;
  } = {},
): Promise<void> {
  const config = loadConfig(environment);
  const providers = config.dataMode === 'live' ? createLiveProviders(config) : [];
  const scopes = config.dataMode === 'live' ? planScopes(config.liveDefaultBboxes) : [];
  const scheduler = createProviderScheduler({
    policies: Object.fromEntries(
      providers.map(({ providerId }) => [
        providerId,
        {
          minIntervalMs: config.ingestIntervalMs,
          cacheTtlMs: config.providerCacheTtlMs,
          maxBackoffMs: Math.max(300_000, config.ingestIntervalMs * 32),
        },
      ]),
    ),
  });
  const state: IngestorState = { flights: [], statuses: [] };
  const runOnce = () => runIngestorOnce({ providers, scopes, scheduler, state });
  const writeSummary = dependencies.writeSummary ?? writeJsonLine;
  const writeError = dependencies.writeError ?? writeJsonError;

  if (!args.includes('--continuous')) {
    await writeSummary(await runOnce());
    return;
  }

  const signals = dependencies.signals ?? process;
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  signals.once('SIGINT', onSignal);
  signals.once('SIGTERM', onSignal);
  const controller = startIngestorPolling({
    intervalMs: config.ingestIntervalMs,
    runOnce,
    writeSummary,
    writeError,
    signal: abort.signal,
  });
  await new Promise<void>((resolve) =>
    abort.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
  controller.stop();
  await controller.currentCycle();
  signals.removeListener('SIGINT', onSignal);
  signals.removeListener('SIGTERM', onSignal);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  void runCli()
    .catch(async () => {
      process.exitCode = 1;
      await writeJsonError({ event: 'ingestor.failed', code: 'INGESTOR_FAILED' });
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
