import {
  ProviderError,
  type FlightPositionProvider,
  type ProviderErrorCode,
  type ProviderSnapshot,
} from '@hangban/adapters';
import type { Flight, SourceStatus } from '@hangban/contracts';
import { classifyFreshness, fuseFlights, normalizeProviderFlight } from '@hangban/domain';

import {
  ProviderSchedulerError,
  type ProviderScheduler,
  type ScheduledProviderSnapshot,
} from './provider-scheduler';
import type { CollectionScope } from './scope-planner';

export type RunCycleOptions = {
  providers: FlightPositionProvider[];
  scopes: CollectionScope[];
  previousFlights: Flight[];
  previousStatuses: SourceStatus[];
  scheduler: ProviderScheduler;
  now?: () => Date;
};

export type RunCycleResult = {
  flights: Flight[];
  statuses: SourceStatus[];
  observedAt: string;
  successfulProviders: number;
};

type ProviderResult = {
  snapshots: ScheduledProviderSnapshot[];
  failures: { error: unknown; requestAttempted: boolean }[];
};

const safeMessages: Record<ProviderErrorCode, string> = {
  RATE_LIMITED: '数据源请求频率受限',
  AUTH_FAILED: '数据源认证失败',
  TIMEOUT: '数据源请求超时',
  INVALID_RESPONSE: '数据源响应无效',
  UPSTREAM_ERROR: '数据源暂时不可用',
};

function stableError(error: unknown): { errorCode: ProviderErrorCode; message: string } {
  const errorCode = error instanceof ProviderError ? error.code : 'UPSTREAM_ERROR';
  return { errorCode, message: safeMessages[errorCode] };
}

function mostRecentObservedAt(snapshots: ProviderSnapshot[]): string {
  return snapshots.reduce(
    (latest, snapshot) =>
      Date.parse(snapshot.observedAt) > Date.parse(latest) ? snapshot.observedAt : latest,
    snapshots[0]!.observedAt,
  );
}

function retainedFlights(previousFlights: Flight[], now: Date): Flight[] {
  return previousFlights.map((flight) => ({
    ...flight,
    freshness: classifyFreshness(flight.observedAt, now),
  }));
}

function preventFlightRegression(
  flights: Flight[],
  previousFlights: Flight[],
  now: Date,
): Flight[] {
  const previousById = new Map(previousFlights.map((flight) => [flight.id, flight]));
  return flights.map((flight) => {
    const previous = previousById.get(flight.id);
    if (previous === undefined || previous.icao24 !== flight.icao24) return flight;
    if (Date.parse(previous.observedAt) > Date.parse(flight.observedAt)) {
      return { ...previous, freshness: classifyFreshness(previous.observedAt, now) };
    }
    return {
      ...flight,
      ...(flight.airline === undefined && previous.airline !== undefined
        ? { airline: previous.airline }
        : {}),
      ...(flight.aircraftType === undefined && previous.aircraftType !== undefined
        ? { aircraftType: previous.aircraftType }
        : {}),
      ...(flight.registration === undefined && previous.registration !== undefined
        ? { registration: previous.registration }
        : {}),
      ...(flight.origin === undefined && previous.origin !== undefined
        ? { origin: previous.origin }
        : {}),
      ...(flight.destination === undefined && previous.destination !== undefined
        ? { destination: previous.destination }
        : {}),
      fieldSources: [
        ...previous.fieldSources,
        ...flight.fieldSources.filter(
          (source) =>
            !previous.fieldSources.some(
              (item) => item.field === source.field && item.providerId === source.providerId,
            ),
        ),
      ],
      inferredFields: [...new Set([...previous.inferredFields, ...flight.inferredFields])],
    };
  });
}

function maxTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export async function runCycle({
  providers,
  scopes,
  previousFlights,
  previousStatuses,
  scheduler,
  now = () => new Date(),
}: RunCycleOptions): Promise<RunCycleResult> {
  const seenProviderIds = new Set<string>();
  for (const provider of providers) {
    if (seenProviderIds.has(provider.providerId)) {
      throw new RangeError(`Duplicate provider ID: ${provider.providerId}`);
    }
    seenProviderIds.add(provider.providerId);
  }
  const cycleTime = now();
  const observedAt = cycleTime.toISOString();

  if (scopes.length === 0 || providers.length === 0) {
    return {
      flights: retainedFlights(previousFlights, cycleTime),
      statuses: previousStatuses,
      observedAt,
      successfulProviders: 0,
    };
  }

  const tasks = providers.flatMap((provider, providerIndex) =>
    scheduler
      .prioritizeScopes(provider.providerId, scopes)
      .map((scope) => ({ providerIndex, promise: scheduler.fetch(provider, scope) })),
  );
  const settled = await Promise.allSettled(tasks.map(({ promise }) => promise));
  const byProvider: ProviderResult[] = providers.map(() => ({ snapshots: [], failures: [] }));

  settled.forEach((result, index) => {
    const providerResult = byProvider[tasks[index]!.providerIndex]!;
    if (result.status === 'fulfilled') providerResult.snapshots.push(result.value);
    else {
      providerResult.failures.push({
        error: result.reason,
        requestAttempted:
          result.reason instanceof ProviderSchedulerError ? result.reason.requestAttempted : true,
      });
    }
  });

  const previousStatusByProvider = new Map(
    previousStatuses.map((status) => [status.providerId, status]),
  );
  const candidates: Flight[] = [];
  const statuses: SourceStatus[] = [];
  let successfulProviders = 0;

  providers.forEach((provider, providerIndex) => {
    const result = byProvider[providerIndex]!;
    const previousStatus = previousStatusByProvider.get(provider.providerId);

    const upstreamSnapshots = result.snapshots.filter(({ upstreamSucceeded }) => upstreamSucceeded);
    const attemptedFailures = result.failures.filter(({ requestAttempted }) => requestAttempted);

    if (upstreamSnapshots.length === 0 && attemptedFailures.length === 0) {
      if (previousStatus !== undefined) statuses.push(previousStatus);
      else {
        const cachedSnapshots = result.snapshots.map(({ snapshot }) => snapshot);
        statuses.push({
          providerId: provider.providerId,
          state: cachedSnapshots.length > 0 ? 'healthy' : 'down',
          lastSuccessAt: cachedSnapshots.length > 0 ? mostRecentObservedAt(cachedSnapshots) : null,
          ...(cachedSnapshots.length > 0
            ? {
                lastRecordCount: fuseFlights(
                  cachedSnapshots.flatMap(({ flights }) =>
                    flights.flatMap((candidate) => {
                      try {
                        return [normalizeProviderFlight(candidate, cycleTime)];
                      } catch {
                        return [];
                      }
                    }),
                  ),
                  cycleTime,
                ).length,
              }
            : {}),
        });
      }
    } else if (upstreamSnapshots.length === 0) {
      const failure = stableError(attemptedFailures[0]!.error);
      const lastSuccessAt = previousStatus?.lastSuccessAt ?? null;
      const hasRecentSnapshot =
        lastSuccessAt !== null && classifyFreshness(lastSuccessAt, cycleTime) !== 'stale';
      statuses.push({
        providerId: provider.providerId,
        state: hasRecentSnapshot ? 'degraded' : 'down',
        lastAttemptAt: observedAt,
        lastSuccessAt,
        ...(previousStatus?.lastRecordCount === undefined
          ? {}
          : { lastRecordCount: previousStatus.lastRecordCount }),
        ...failure,
      });
    } else {
      successfulProviders += 1;
    }

    let invalidRecords = 0;
    const providerCandidates: Flight[] = [];
    for (const { snapshot } of result.snapshots) {
      for (const candidate of snapshot.flights) {
        try {
          const normalized = normalizeProviderFlight(candidate, cycleTime);
          providerCandidates.push(normalized);
          candidates.push(normalized);
        } catch {
          invalidRecords += 1;
        }
      }
    }
    if (upstreamSnapshots.length === 0) return;

    const lastRecordCount = fuseFlights(providerCandidates, cycleTime).length;
    const previousLastSuccessAt = previousStatus?.lastSuccessAt ?? null;
    const rejectedOlderSnapshot = upstreamSnapshots.some(
      ({ snapshotAccepted }) => !snapshotAccepted,
    );
    const isDegraded = attemptedFailures.length > 0 || invalidRecords > 0 || rejectedOlderSnapshot;
    const failure =
      attemptedFailures.length > 0 ? stableError(attemptedFailures[0]!.error) : undefined;
    const reasons = [
      ...(attemptedFailures.length > 0 ? [`${attemptedFailures.length} 个采集范围请求失败`] : []),
      ...(invalidRecords > 0 ? [`已丢弃 ${invalidRecords} 条无效记录`] : []),
      ...(rejectedOlderSnapshot ? ['已忽略时间早于当前快照的响应'] : []),
    ];
    const currentLastSuccessAt = mostRecentObservedAt(
      upstreamSnapshots.map(({ snapshot }) => snapshot),
    );
    statuses.push({
      providerId: provider.providerId,
      state: isDegraded ? 'degraded' : 'healthy',
      lastAttemptAt: observedAt,
      lastSuccessAt:
        previousLastSuccessAt === null
          ? currentLastSuccessAt
          : maxTimestamp(previousLastSuccessAt, currentLastSuccessAt),
      lastRecordCount,
      ...(failure !== undefined
        ? { errorCode: failure.errorCode }
        : rejectedOlderSnapshot
          ? { errorCode: 'INVALID_RESPONSE' as const }
          : {}),
      ...(reasons.length === 0 ? {} : { message: reasons.join('；') }),
    });
  });

  return {
    flights:
      successfulProviders === 0
        ? retainedFlights(previousFlights, cycleTime)
        : preventFlightRegression(fuseFlights(candidates, cycleTime), previousFlights, cycleTime),
    statuses,
    observedAt,
    successfulProviders,
  };
}
