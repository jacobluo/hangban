import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createRedisConnections, RedisLease } from './index';

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('RedisLease', () => {
  const prefix = `hangban-test-lease:${process.pid}`;
  const connections = createRedisConnections(redisUrl!);
  const primary = new RedisLease(connections.command, { key: `${prefix}:owner`, ttlMs: 15_000 });
  const standby = new RedisLease(connections.publisher, { key: `${prefix}:owner`, ttlMs: 15_000 });

  beforeAll(async () => connections.connect());
  beforeEach(async () => connections.command.del(`${prefix}:owner`));
  afterAll(async () => {
    await connections.command.del(`${prefix}:owner`);
    await connections.close();
  });

  it('allows only the token owner to renew and release', async () => {
    expect(await primary.acquire()).toBe(true);
    expect(await standby.acquire()).toBe(false);
    expect(await standby.renew()).toBe(false);
    expect(await standby.release()).toBe(false);
    expect(await primary.renew()).toBe(true);
    expect(await primary.release()).toBe(true);
    expect(await standby.acquire()).toBe(true);
  });
});
