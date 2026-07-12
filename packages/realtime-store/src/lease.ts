import { randomUUID } from 'node:crypto';

import type { RedisConnection } from './client';

const RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisLease {
  private readonly token = randomUUID();
  private readonly key: string;
  private readonly ttlMs: number;

  constructor(
    private readonly redis: Pick<RedisConnection, 'set' | 'eval'>,
    { key, ttlMs }: { key: string; ttlMs: number },
  ) {
    this.key = key;
    this.ttlMs = ttlMs;
  }

  async acquire(): Promise<boolean> {
    return (await this.redis.set(this.key, this.token, { NX: true, PX: this.ttlMs })) === 'OK';
  }

  async renew(): Promise<boolean> {
    const result = await this.redis.eval(RENEW, {
      keys: [this.key],
      arguments: [this.token, String(this.ttlMs)],
    });
    return Number(result) === 1;
  }

  async release(): Promise<boolean> {
    const result = await this.redis.eval(RELEASE, {
      keys: [this.key],
      arguments: [this.token],
    });
    return Number(result) === 1;
  }
}
