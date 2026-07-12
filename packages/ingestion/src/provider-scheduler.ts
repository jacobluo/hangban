import {
  ProviderError,
  type FlightPositionProvider,
  type ProviderSnapshot,
} from '@hangban/adapters';

import type { CollectionScope } from './scope-planner';

const AIRPLANES_LIVE_MINIMUM_MS = 180_000;
const ZERO_INTERVAL_BACKOFF_BASE_MS = 1_000;
const DEFAULT_MAX_CACHE_ENTRIES = 512;

export type ProviderPolicy = {
  minIntervalMs: number;
  cacheTtlMs: number;
  maxBackoffMs: number;
};

export type ProviderScheduler = {
  fetch(
    provider: FlightPositionProvider,
    scope: CollectionScope,
  ): Promise<ScheduledProviderSnapshot>;
  prioritizeScopes(providerId: string, scopes: readonly CollectionScope[]): CollectionScope[];
  nextAllowedAt(providerId: string): number | null;
  cacheSize(): number;
  clear(): void;
};

export type ScheduledProviderSnapshot = {
  snapshot: ProviderSnapshot;
  source: 'upstream' | 'cache' | 'stale-cache';
  requestAttempted: boolean;
  upstreamSucceeded: boolean;
  snapshotAccepted: boolean;
};

export class ProviderSchedulerError extends ProviderError {
  constructor(
    error: unknown,
    public readonly requestAttempted: boolean,
  ) {
    const providerError = error instanceof ProviderError ? error : undefined;
    super(
      providerError?.code ?? 'UPSTREAM_ERROR',
      providerError?.message ?? 'Provider request failed',
      providerError?.retryAfterMs,
    );
    this.name = 'ProviderSchedulerError';
  }
}

type ProviderState = {
  failureCount: number;
  failureRevision: number;
  nextAllowedAt: number;
};
type CacheEntry = { snapshot: ProviderSnapshot; storedAt: number };

function validatePolicy(policy: ProviderPolicy): void {
  if (
    !Number.isFinite(policy.minIntervalMs) ||
    policy.minIntervalMs < 0 ||
    !Number.isFinite(policy.cacheTtlMs) ||
    policy.cacheTtlMs < 0 ||
    !Number.isFinite(policy.maxBackoffMs) ||
    policy.maxBackoffMs <= 0
  ) {
    throw new RangeError('Provider policy intervals are invalid');
  }
}

export function normalizeProviderPolicy(
  providerId: string,
  policy: ProviderPolicy,
): ProviderPolicy {
  validatePolicy(policy);
  if (providerId !== 'airplanes-live') return { ...policy };
  return {
    ...policy,
    minIntervalMs: Math.max(policy.minIntervalMs, AIRPLANES_LIVE_MINIMUM_MS),
    cacheTtlMs: Math.max(policy.cacheTtlMs, AIRPLANES_LIVE_MINIMUM_MS),
  };
}

export function createProviderScheduler(options: {
  policies: Record<string, ProviderPolicy>;
  now?: () => number | Date;
  maxCacheEntries?: number;
}): ProviderScheduler {
  const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new RangeError('maxCacheEntries must be a positive integer');
  }
  const policies = new Map(
    Object.entries(options.policies).map(([providerId, policy]) => [
      providerId,
      normalizeProviderPolicy(providerId, policy),
    ]),
  );
  const clock = (): number => {
    const value = options.now?.() ?? Date.now();
    return value instanceof Date ? value.getTime() : value;
  };
  const states = new Map<string, ProviderState>();
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<ScheduledProviderSnapshot>>();
  const priorityKeys = new Map<string, string[]>();
  const nextScopeKeys = new Map<string, string>();
  let generation = 0;

  const touchCache = (key: string, entry: CacheEntry): void => {
    cache.delete(key);
    cache.set(key, entry);
  };

  const storeCache = (key: string, entry: CacheEntry): void => {
    touchCache(key, entry);
    while (cache.size > maxCacheEntries) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  };

  const advanceScopePriority = (providerId: string, scopeKey: string): void => {
    const keys = priorityKeys.get(providerId);
    if (keys === undefined || keys.length === 0) return;
    const currentIndex = keys.indexOf(scopeKey);
    if (currentIndex === -1) return;
    nextScopeKeys.set(providerId, keys[(currentIndex + 1) % keys.length]!);
  };

  const fetch = async (
    provider: FlightPositionProvider,
    scope: CollectionScope,
  ): Promise<ScheduledProviderSnapshot> => {
    const policy = policies.get(provider.providerId);
    if (!policy) throw new RangeError(`Missing policy for provider: ${provider.providerId}`);
    const key = `${provider.providerId}:${scope.cacheKey}`;
    const timestamp = clock();
    const cached = cache.get(key);
    if (cached && timestamp - cached.storedAt < policy.cacheTtlMs) {
      touchCache(key, cached);
      return {
        snapshot: cached.snapshot,
        source: 'cache',
        requestAttempted: false,
        upstreamSucceeded: false,
        snapshotAccepted: true,
      };
    }

    const pending = inFlight.get(key);
    if (pending) return pending;

    const state = states.get(provider.providerId);
    if (state && timestamp < state.nextAllowedAt) {
      if (cached) {
        touchCache(key, cached);
        return {
          snapshot: cached.snapshot,
          source: 'stale-cache',
          requestAttempted: false,
          upstreamSucceeded: false,
          snapshotAccepted: true,
        };
      }
      const retryAfterMs = state.nextAllowedAt - timestamp;
      throw new ProviderSchedulerError(
        new ProviderError('RATE_LIMITED', 'Provider request is deferred', retryAfterMs),
        false,
      );
    }

    advanceScopePriority(provider.providerId, scope.cacheKey);
    const startFailureRevision = state?.failureRevision ?? 0;
    states.set(provider.providerId, {
      failureCount: state?.failureCount ?? 0,
      failureRevision: startFailureRevision,
      nextAllowedAt: timestamp + policy.minIntervalMs,
    });
    const requestGeneration = generation;
    const request = Promise.resolve()
      .then(() => provider.fetchSnapshot({ bbox: scope.bbox }))
      .then((result) => {
        const snapshotAccepted =
          cached === undefined ||
          Date.parse(result.observedAt) >= Date.parse(cached.snapshot.observedAt);
        const selectedSnapshot = snapshotAccepted ? result : cached.snapshot;
        if (requestGeneration === generation) {
          if (snapshotAccepted) storeCache(key, { snapshot: result, storedAt: clock() });
          else storeCache(key, cached!);
          const currentState = states.get(provider.providerId);
          if (currentState?.failureRevision === startFailureRevision) {
            states.set(provider.providerId, {
              failureCount: 0,
              failureRevision: currentState.failureRevision,
              nextAllowedAt: Math.max(currentState.nextAllowedAt, clock() + policy.minIntervalMs),
            });
          }
        }
        return {
          snapshot: selectedSnapshot,
          source: 'upstream' as const,
          requestAttempted: true,
          upstreamSucceeded: true,
          snapshotAccepted,
        };
      })
      .catch((error: unknown) => {
        if (requestGeneration === generation) {
          const currentState = states.get(provider.providerId);
          const failureCount = (currentState?.failureCount ?? 0) + 1;
          const base = policy.minIntervalMs || ZERO_INTERVAL_BACKOFF_BASE_MS;
          const exponentialDelay = Math.min(policy.maxBackoffMs, base * 2 ** (failureCount - 1));
          const retryAfterMs =
            error instanceof ProviderError && error.code === 'RATE_LIMITED'
              ? Math.max(error.retryAfterMs ?? 0, exponentialDelay)
              : exponentialDelay;
          states.set(provider.providerId, {
            failureCount,
            failureRevision: (currentState?.failureRevision ?? startFailureRevision) + 1,
            nextAllowedAt: Math.max(currentState?.nextAllowedAt ?? 0, clock() + retryAfterMs),
          });
        }
        throw new ProviderSchedulerError(error, true);
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  };

  return {
    fetch,
    prioritizeScopes(providerId, scopes) {
      if (scopes.length === 0) return [];
      const keys = scopes.map(({ cacheKey }) => cacheKey);
      priorityKeys.set(providerId, keys);
      const nextScopeKey = nextScopeKeys.get(providerId);
      const cursor = nextScopeKey === undefined ? 0 : Math.max(0, keys.indexOf(nextScopeKey));
      return [...scopes.slice(cursor), ...scopes.slice(0, cursor)];
    },
    nextAllowedAt(providerId) {
      return states.get(providerId)?.nextAllowedAt ?? null;
    },
    cacheSize() {
      return cache.size;
    },
    clear() {
      generation += 1;
      states.clear();
      cache.clear();
      inFlight.clear();
      priorityKeys.clear();
      nextScopeKeys.clear();
    },
  };
}
