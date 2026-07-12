import type { FlightMetadataProvider, AircraftMetadata, CallsignMetadata } from '@hangban/adapters';
import { MetadataProviderError } from '@hangban/adapters';
import type { Flight, FlightFieldSource } from '@hangban/contracts';

type Options = {
  provider: FlightMetadataProvider;
  onFlightEnriched(id: string, patch: Partial<Flight>, expectedIcao24: string): void;
  concurrency?: number;
  aircraftCacheTtlMs?: number;
  routeCacheTtlMs?: number;
  negativeCacheTtlMs?: number;
  maxCacheEntries?: number;
  now?: () => Date;
};
type Cache<T> = { value?: T; expires: number };

export function createFlightMetadataEnricher({
  provider,
  onFlightEnriched,
  concurrency = 4,
  aircraftCacheTtlMs = 86_400_000,
  routeCacheTtlMs = 21_600_000,
  negativeCacheTtlMs = 300_000,
  maxCacheEntries = 10_000,
  now = () => new Date(),
}: Options) {
  const aircraftCache = new Map<string, Cache<AircraftMetadata>>(),
    routeCache = new Map<string, Cache<CallsignMetadata>>(),
    queued = new Set<string>(),
    latest = new Map<string, Flight>();
  const queue: Flight[] = [];
  let active = 0,
    stopped = false;
  const idleWaiters: Array<() => void> = [];
  const trim = <T>(cache: Map<string, T>) => {
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value as string);
  };
  const cached = async <T>(
    cache: Map<string, Cache<T>>,
    key: string,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T | undefined> => {
    const hit = cache.get(key);
    if (hit && hit.expires > now().getTime()) return hit.value;
    try {
      const value = await load();
      cache.set(key, { value, expires: now().getTime() + ttl });
      trim(cache);
      return value;
    } catch (error) {
      if (error instanceof MetadataProviderError) {
        cache.set(key, { expires: now().getTime() + negativeCacheTtlMs });
        trim(cache);
        return undefined;
      }
      throw error;
    }
  };
  const settle = () => {
    if (active === 0 && queue.length === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
  };
  const pump = () => {
    while (!stopped && active < concurrency && queue.length) {
      const flight = queue.shift()!;
      active++;
      void (async () => {
        const aircraft = await cached(aircraftCache, flight.icao24, aircraftCacheTtlMs, () =>
          provider.fetchAircraft(flight.icao24),
        );
        const route = await cached(routeCache, flight.callsign, routeCacheTtlMs, () =>
          provider.fetchCallsign(flight.callsign),
        );
        if (stopped || latest.get(flight.id)?.icao24 !== flight.icao24) return;
        const observedAt = now().toISOString();
        const fieldSources: FlightFieldSource[] = [];
        const patch: Partial<Flight> = {};
        const add = (
          field: FlightFieldSource['field'],
          value: string | undefined,
          inferred: boolean,
          confidence: number,
        ) => {
          if (!value || flight[field] !== undefined) return;
          Object.assign(patch, { [field]: value });
          fieldSources.push({
            field,
            providerId: provider.providerId,
            observedAt,
            inferred,
            confidence,
          });
        };
        add('registration', aircraft?.registration, false, 0.9);
        add('aircraftType', aircraft?.aircraftType, false, 0.9);
        add('airline', route?.airline, false, 0.75);
        add('origin', route?.origin, true, 0.65);
        add('destination', route?.destination, true, 0.65);
        if (fieldSources.length) {
          patch.fieldSources = [...flight.fieldSources, ...fieldSources];
          patch.inferredFields = [
            ...new Set([
              ...flight.inferredFields,
              ...fieldSources.filter((s) => s.inferred).map((s) => s.field),
            ]),
          ];
          onFlightEnriched(flight.id, patch, flight.icao24);
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          active--;
          queued.delete(flight.id);
          pump();
          settle();
        });
    }
    settle();
  };
  return {
    observe(flights: readonly Flight[]): void {
      for (const flight of flights) latest.set(flight.id, flight);
      for (const id of [...latest.keys()]) if (!flights.some((f) => f.id === id)) latest.delete(id);
      for (const flight of flights)
        if (!queued.has(flight.id)) {
          queued.add(flight.id);
          queue.push(flight);
        }
      pump();
    },
    whenIdle(): Promise<void> {
      if (!active && !queue.length) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    stats: () => ({
      queued: queue.length,
      inFlight: active,
      cacheEntries: aircraftCache.size + routeCache.size,
    }),
    stop(): void {
      stopped = true;
      queue.splice(0);
      settle();
    },
  };
}
