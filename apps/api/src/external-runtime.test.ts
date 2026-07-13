import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, type RuntimeConfig } from '@hangban/config';
import { createPostgresPool } from '@hangban/persistence';

import { createExternalApiRuntime } from './external-runtime';

describe('createExternalApiRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects live startup without both external stores', async () => {
    const config = { ...loadConfig({ DATA_MODE: 'demo' }), dataMode: 'live' } as RuntimeConfig;
    await expect(createExternalApiRuntime(config, { logger: false })).rejects.toThrow(
      'EXTERNAL_STORES_REQUIRED',
    );
  });

  it('closes an already-created pool when Redis construction fails synchronously', async () => {
    const probe = createPostgresPool({
      connectionString: 'postgresql://test:test@127.0.0.1/test',
    });
    const poolPrototype = Object.getPrototypeOf(probe) as { end(): Promise<void> };
    await probe.end();
    const end = vi.spyOn(poolPrototype, 'end').mockImplementation(() => Promise.resolve());
    const config = loadConfig({
      DATA_MODE: 'live',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
      REDIS_URL: 'not-a-url',
    });

    await expect(createExternalApiRuntime(config, { logger: false })).rejects.toThrow(
      'Invalid URL',
    );
    expect(end).toHaveBeenCalledOnce();
  });
});
