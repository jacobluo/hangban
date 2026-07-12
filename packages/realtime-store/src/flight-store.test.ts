import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDemoFlights } from '@hangban/testkit';

import { createRedisConnections, RedisFlightStore } from './index';

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('RedisFlightStore', () => {
  const prefix = `hangban-test:${process.pid}`;
  const connections = createRedisConnections(redisUrl!);
  const store = new RedisFlightStore(connections.command, { prefix, ttlMs: 60_000 });
  const observedAt = '2026-07-12T08:00:00.000Z';
  const [demoFlight] = createDemoFlights(new Date(observedAt));
  const flight = { ...demoFlight!, longitude: 116, latitude: 40 };
  const status = {
    providerId: 'fixture',
    state: 'healthy' as const,
    lastSuccessAt: observedAt,
    lastRecordCount: 1,
  };

  beforeAll(async () => connections.connect());
  beforeEach(async () => {
    const keys = await connections.command.keys(`${prefix}:*`);
    if (keys.length) await connections.command.del(keys);
  });
  afterAll(async () => {
    const keys = await connections.command.keys(`${prefix}:*`);
    if (keys.length) await connections.command.del(keys);
    await connections.close();
  });

  it('atomically replaces the active flight cycle and source statuses', async () => {
    await store.commitCycle({ flights: [flight!], statuses: [status], observedAt });
    expect(await store.snapshotByBbox([110, 20, 130, 50])).toEqual([flight]);
    expect(await store.sourceStatuses()).toEqual([status]);

    await store.commitCycle({
      flights: [],
      statuses: [{ ...status, lastRecordCount: 0 }],
      observedAt: '2026-07-12T08:00:10.000Z',
    });
    expect(await store.snapshotByBbox([110, 20, 130, 50])).toEqual([]);
  });

  it('returns flights across a bbox that crosses the date line without duplicates', async () => {
    const west = { ...flight!, id: 'west', longitude: 179 };
    const east = { ...flight!, id: 'east', longitude: -179 };
    await store.commitCycle({ flights: [west, east], statuses: [status], observedAt });
    expect((await store.snapshotByBbox([170, 20, -170, 50])).map(({ id }) => id).sort()).toEqual([
      'east',
      'west',
    ]);
  });

  it('isolates malformed flight JSON', async () => {
    await store.commitCycle({ flights: [flight!], statuses: [status], observedAt });
    await connections.command.set(`${prefix}:flight:${flight!.id}`, '{broken');
    await expect(store.snapshotByBbox([110, 20, 130, 50])).resolves.toEqual([]);
  });
});
