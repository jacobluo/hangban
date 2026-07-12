import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDemoFlights } from '@hangban/testkit';

import { createRedisConnections, publishChanges, subscribeChanges } from './index';

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('Redis realtime events', () => {
  const prefix = `hangban-test-events:${process.pid}`;
  const connections = createRedisConnections(redisUrl!);

  beforeAll(async () => connections.connect());
  afterAll(async () => connections.close());

  it('publishes validated events and skips malformed messages', async () => {
    const received: unknown[] = [];
    const invalid = vi.fn();
    const unsubscribe = await subscribeChanges(connections.subscriber, {
      prefix,
      onEvent: (event) => {
        received.push(event);
      },
      onInvalid: invalid,
    });
    const [flight] = createDemoFlights(new Date('2026-07-12T08:00:00.000Z'));

    await connections.publisher.publish(`${prefix}:changes`, '{broken');
    await publishChanges(connections.publisher, prefix, [
      { type: 'flight.upsert', flight: flight! },
    ]);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(invalid).toHaveBeenCalledWith('INVALID_REALTIME_EVENT');
    expect(received[0]).toMatchObject({ type: 'flight.upsert', flight: { id: flight!.id } });
    await unsubscribe();
  });

  it('rejects an invalid outbound event', async () => {
    await expect(
      publishChanges(connections.publisher, prefix, [{ type: 'flight.remove', flightId: '' }]),
    ).rejects.toThrow();
  });
});
