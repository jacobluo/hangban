import {
  flightSchema,
  sourceStatusSchema,
  type Bbox,
  type Flight,
  type SourceStatus,
} from '@hangban/contracts';

import type { RedisConnection } from './client';

const COMMIT_CYCLE = `
local activeKey = KEYS[1]
local geoKey = KEYS[2]
local statusKey = KEYS[3]
local prefix = ARGV[1]
local ttl = ARGV[2]
local statuses = ARGV[3]
local nextIds = {}
local removed = {}

for index = 4, #ARGV, 4 do
  local id = ARGV[index]
  nextIds[id] = true
  redis.call('SET', prefix .. ':flight:' .. id, ARGV[index + 1], 'PX', ttl)
  redis.call('GEOADD', geoKey, ARGV[index + 2], ARGV[index + 3], id)
end

for _, id in ipairs(redis.call('SMEMBERS', activeKey)) do
  if not nextIds[id] then
    redis.call('DEL', prefix .. ':flight:' .. id)
    redis.call('ZREM', geoKey, id)
    table.insert(removed, id)
  end
end

redis.call('DEL', activeKey)
for id, _ in pairs(nextIds) do redis.call('SADD', activeKey, id) end
redis.call('SET', statusKey, statuses, 'PX', ttl)
redis.call('PEXPIRE', activeKey, ttl)
redis.call('PEXPIRE', geoKey, ttl)
return cjson.encode(removed)
`;

export type CommitCycleInput = {
  flights: readonly Flight[];
  statuses: readonly SourceStatus[];
  observedAt: string;
};

export type CommitCycleResult = { upsertedIds: string[]; removedIds: string[] };

export class RedisFlightStore {
  private readonly prefix: string;
  private readonly ttlMs: number;

  constructor(
    private readonly redis: RedisConnection,
    { prefix = 'hangban', ttlMs = 60_000 }: { prefix?: string; ttlMs?: number } = {},
  ) {
    this.prefix = prefix;
    this.ttlMs = ttlMs;
  }

  async commitCycle({ flights, statuses }: CommitCycleInput): Promise<CommitCycleResult> {
    const validFlights = flights.map((flight) => flightSchema.parse(flight));
    const validStatuses = statuses.map((status) => sourceStatusSchema.parse(status));
    const args = [this.prefix, String(this.ttlMs), JSON.stringify(validStatuses)];
    for (const flight of validFlights) {
      args.push(
        flight.id,
        JSON.stringify(flight),
        String(flight.longitude),
        String(flight.latitude),
      );
    }
    const raw = await this.redis.eval(COMMIT_CYCLE, {
      keys: [this.key('flights:active'), this.key('flights:geo'), this.key('source-statuses')],
      arguments: args,
    });
    const removedIds = JSON.parse(String(raw)) as string[];
    return { upsertedIds: validFlights.map(({ id }) => id), removedIds };
  }

  async snapshotByBbox(bbox: Bbox): Promise<Flight[]> {
    const [west, south, east, north] = bbox;
    const ranges: Array<[number, number]> =
      west <= east
        ? [[west, east]]
        : [
            [west, 180],
            [-180, east],
          ];
    const ids = new Set<string>();
    for (const [rangeWest, rangeEast] of ranges) {
      for (const id of await this.geoIds([rangeWest, south, rangeEast, north])) ids.add(id);
    }
    if (ids.size === 0) return [];
    const values = await this.redis.mGet([...ids].map((id) => this.key(`flight:${id}`)));
    const flights: Flight[] = [];
    for (const value of values) {
      if (!value) continue;
      try {
        const flight = flightSchema.parse(JSON.parse(value));
        if (
          flight.latitude >= south &&
          flight.latitude <= north &&
          (west <= east
            ? flight.longitude >= west && flight.longitude <= east
            : flight.longitude >= west || flight.longitude <= east)
        ) {
          flights.push(flight);
        }
      } catch {
        // One corrupt or partially expired member must not make the whole snapshot unavailable.
      }
    }
    return flights.sort((a, b) => a.id.localeCompare(b.id));
  }

  async sourceStatuses(): Promise<SourceStatus[]> {
    const value = await this.redis.get(this.key('source-statuses'));
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown[];
      return parsed.flatMap((status) => {
        const result = sourceStatusSchema.safeParse(status);
        return result.success ? [result.data] : [];
      });
    } catch {
      return [];
    }
  }

  private key(suffix: string) {
    return `${this.prefix}:${suffix}`;
  }

  private async geoIds([west, south, east, north]: Bbox): Promise<string[]> {
    const centerLongitude = (west + east) / 2;
    const centerLatitude = (south + north) / 2;
    const widthKm = Math.max(
      1,
      (east - west) * 111.32 * Math.max(0.01, Math.cos((centerLatitude * Math.PI) / 180)),
    );
    const heightKm = Math.max(1, (north - south) * 111.32);
    const result = await this.redis.sendCommand([
      'GEOSEARCH',
      this.key('flights:geo'),
      'FROMLONLAT',
      String(centerLongitude),
      String(centerLatitude),
      'BYBOX',
      String(widthKm),
      String(heightKm),
      'km',
    ]);
    return Array.isArray(result) ? result.map(String) : [];
  }
}
