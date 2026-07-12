import type { FlightPositionProvider } from '@hangban/adapters';
import type { Bbox, Flight } from '@hangban/contracts';
import { planScopes, runCycle, type ProviderScheduler } from '@hangban/ingestion';

import type { RealtimeHub } from './realtime/hub';
import type { FlightRepository } from './repository';

export type LiveIngestionController = {
  runNow(): Promise<void>;
  stop(): void;
};

type TimerHandle = ReturnType<typeof setInterval>;

type TimerApi = {
  setInterval(callback: () => void, intervalMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

export type StartLiveIngestionOptions = {
  repository: FlightRepository;
  hub: Pick<RealtimeHub, 'activeBboxes'>;
  providers: FlightPositionProvider[];
  scheduler: ProviderScheduler;
  defaultBboxes: readonly Bbox[];
  intervalMs: number;
  now?: () => Date;
  timers?: TimerApi;
  metadataEnricher?: { observe(flights: readonly Flight[]): void };
};

export function startLiveIngestion({
  repository,
  hub,
  providers,
  scheduler,
  defaultBboxes,
  intervalMs,
  now = () => new Date(),
  timers = { setInterval, clearInterval },
  metadataEnricher,
}: StartLiveIngestionOptions): LiveIngestionController {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('intervalMs must be positive');
  }
  const providerIds = new Set<string>();
  for (const provider of providers) {
    if (providerIds.has(provider.providerId)) {
      throw new RangeError(`Duplicate provider ID: ${provider.providerId}`);
    }
    providerIds.add(provider.providerId);
  }

  let stopped = false;
  let inFlight: Promise<void> | undefined;

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight !== undefined) return inFlight;

    const cycle = (async () => {
      const activeBboxes = hub.activeBboxes();
      const scopes = planScopes(activeBboxes.length > 0 ? activeBboxes : defaultBboxes);
      const result = await runCycle({
        providers,
        scopes,
        previousFlights: repository.allFlights(),
        previousStatuses: repository.sourceStatuses(),
        scheduler,
        now,
      });
      if (!stopped) {
        repository.replaceSnapshot(result.flights, result.statuses);
        metadataEnricher?.observe(result.flights);
      }
    })();
    inFlight = cycle.finally(() => {
      if (inFlight === wrapped) inFlight = undefined;
    });
    const wrapped = inFlight;
    return wrapped;
  };

  const timer = timers.setInterval(() => {
    void runNow().catch(() => undefined);
  }, intervalMs);

  return {
    runNow,
    stop() {
      if (stopped) return;
      stopped = true;
      timers.clearInterval(timer);
    },
  };
}
