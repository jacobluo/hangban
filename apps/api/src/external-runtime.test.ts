import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, type RuntimeConfig } from '@hangban/config';

const runtimeMocks = vi.hoisted(() => ({
  checkPostgres: vi.fn(),
  createPostgresPool: vi.fn(),
  createRedisConnections: vi.fn(),
}));

vi.mock('@hangban/persistence', () => ({
  checkPostgres: runtimeMocks.checkPostgres,
  createPostgresPool: runtimeMocks.createPostgresPool,
  PostgresAirportStore: class PostgresAirportStore {},
}));

vi.mock('@hangban/realtime-store', () => ({
  checkRedis: vi.fn(),
  createRedisConnections: runtimeMocks.createRedisConnections,
  RedisFlightStore: class RedisFlightStore {},
  subscribeChanges: vi.fn(),
}));

import { createExternalApiRuntime } from './external-runtime';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function liveConfig() {
  return loadConfig({
    DATA_MODE: 'live',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
    REDIS_URL: 'redis://cache',
  });
}

describe('createExternalApiRuntime', () => {
  const pool = {
    end: vi.fn(async () => {}),
    query: vi.fn(async () => ({ rows: [] })),
  };
  const connections = {
    command: { isReady: false },
    subscriber: {},
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.createPostgresPool.mockReturnValue(pool);
    runtimeMocks.createRedisConnections.mockReturnValue(connections);
    runtimeMocks.checkPostgres.mockResolvedValue(undefined);
  });

  it('rejects live startup without both external stores', async () => {
    const config = { ...loadConfig({ DATA_MODE: 'demo' }), dataMode: 'live' } as RuntimeConfig;
    await expect(createExternalApiRuntime(config, { logger: false })).rejects.toThrow(
      'EXTERNAL_STORES_REQUIRED',
    );
  });

  it('closes an already-created pool when Redis construction fails synchronously', async () => {
    runtimeMocks.createRedisConnections.mockImplementation(() => {
      throw new TypeError('Invalid URL');
    });

    await expect(createExternalApiRuntime(liveConfig(), { logger: false })).rejects.toThrow(
      'Invalid URL',
    );
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('waits for Redis connection settlement before cleaning up a PostgreSQL failure', async () => {
    const redisConnect = deferred<void>();
    const postgresFailure = new Error('PostgreSQL unavailable');
    runtimeMocks.checkPostgres.mockRejectedValue(postgresFailure);
    connections.connect.mockReturnValue(redisConnect.promise);

    let settled = false;
    const result = createExternalApiRuntime(liveConfig(), { logger: false }).then(
      () => {
        settled = true;
        return null;
      },
      (error: Error) => {
        settled = true;
        return error;
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(connections.close).not.toHaveBeenCalled();
    expect(pool.end).not.toHaveBeenCalled();

    redisConnect.resolve();
    await expect(result).resolves.toBe(postgresFailure);
    expect(connections.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
