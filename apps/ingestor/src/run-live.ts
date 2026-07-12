import { pathToFileURL } from 'node:url';

import { createAdsbdbProvider, createLiveProviders } from '@hangban/adapters';
import { loadConfig } from '@hangban/config';
import { flightSchema, type Flight, type SourceStatus } from '@hangban/contracts';
import {
  createFlightMetadataEnricher,
  createProviderScheduler,
  planScopes,
  runCycle,
} from '@hangban/ingestion';
import {
  createRedisConnections,
  publishChanges,
  RedisFlightStore,
  RedisLease,
  type CommitCycleInput,
} from '@hangban/realtime-store';

type LeasePort = { acquire(): Promise<boolean>; renew(): Promise<boolean> };
type StorePort = { commitCycle(cycle: CommitCycleInput): Promise<unknown> };

export async function commitIfLeaseOwner({
  lease,
  collect,
  store,
}: {
  lease: LeasePort;
  collect: () => Promise<CommitCycleInput>;
  store: StorePort;
}): Promise<'standby' | 'lease-lost' | 'committed'> {
  if (!(await lease.acquire())) return 'standby';
  const cycle = await collect();
  if (!(await lease.renew())) return 'lease-lost';
  await store.commitCycle(cycle);
  return 'committed';
}

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export async function startExternalIngestor(
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  const config = loadConfig(environment);
  if (config.dataMode !== 'live' || !config.redisUrl) throw new Error('LIVE_MODE_REQUIRED');
  const connections = createRedisConnections(config.redisUrl);
  await connections.connect();
  const store = new RedisFlightStore(connections.command, { prefix: config.redisKeyPrefix });
  const lease = new RedisLease(connections.command, {
    key: `${config.redisKeyPrefix}:ingestor:lease`,
    ttlMs: config.ingestorLeaseTtlMs,
  });
  const providers = createLiveProviders(config);
  const scopes = planScopes(config.liveDefaultBboxes);
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
  let previousFlights: Flight[] = [];
  let previousStatuses: SourceStatus[] = [];
  let enrichedFlights: Flight[] = [];
  const metadataEnricher = createFlightMetadataEnricher({
    provider: createAdsbdbProvider({
      baseUrl: config.adsbdbBaseUrl,
      timeoutMs: config.adsbdbTimeoutMs,
    }),
    concurrency: config.adsbdbConcurrency,
    aircraftCacheTtlMs: config.adsbdbAircraftCacheTtlMs,
    routeCacheTtlMs: config.adsbdbRouteCacheTtlMs,
    negativeCacheTtlMs: config.adsbdbNegativeCacheTtlMs,
    onFlightEnriched: (id, patch, expectedIcao24) => {
      const index = enrichedFlights.findIndex(
        (flight) => flight.id === id && flight.icao24 === expectedIcao24,
      );
      if (index >= 0)
        enrichedFlights[index] = flightSchema.parse({ ...enrichedFlights[index], ...patch });
    },
  });
  let ownsLease = false;
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    while (!abort.signal.aborted) {
      ownsLease = ownsLease ? await lease.renew() : await lease.acquire();
      if (!ownsLease) {
        await wait(Math.min(5_000, config.ingestIntervalMs), abort.signal);
        continue;
      }
      try {
        const result = await runCycle({
          providers,
          scopes,
          previousFlights,
          previousStatuses,
          scheduler,
        });
        enrichedFlights = [...result.flights];
        metadataEnricher.observe(enrichedFlights);
        await metadataEnricher.whenIdle();
        ownsLease = await lease.renew();
        if (!ownsLease) continue;
        const committedCycle = { ...result, flights: enrichedFlights };
        const changes = await store.commitCycle(committedCycle);
        await publishChanges(connections.publisher, config.redisKeyPrefix, [
          ...enrichedFlights.map((flight) => ({ type: 'flight.upsert' as const, flight })),
          ...changes.removedIds.map((flightId) => ({ type: 'flight.remove' as const, flightId })),
          ...result.statuses.map((status) => ({ type: 'source.status' as const, status })),
        ]);
        previousFlights = enrichedFlights;
        previousStatuses = result.statuses;
        process.stdout.write(
          `${JSON.stringify({ event: 'ingestion.cycle', observedAt: result.observedAt, flights: result.flights.length })}\n`,
        );
      } catch {
        process.stderr.write(
          `${JSON.stringify({ event: 'ingestion.cycle.failed', code: 'INGESTION_CYCLE_FAILED' })}\n`,
        );
      }
      await wait(config.ingestIntervalMs, abort.signal);
    }
  } finally {
    metadataEnricher.stop();
    if (ownsLease) await lease.release().catch(() => false);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await connections.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void startExternalIngestor().catch(() => {
    process.exitCode = 1;
    process.stderr.write(
      `${JSON.stringify({ event: 'ingestor.failed', code: 'INGESTOR_FAILED' })}\n`,
    );
  });
}
