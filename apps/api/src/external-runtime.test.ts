import { describe, expect, it } from 'vitest';

import { loadConfig, type RuntimeConfig } from '@hangban/config';

import { createExternalApiRuntime } from './external-runtime';

describe('createExternalApiRuntime', () => {
  it('rejects live startup without both external stores', async () => {
    const config = { ...loadConfig({ DATA_MODE: 'demo' }), dataMode: 'live' } as RuntimeConfig;
    await expect(createExternalApiRuntime(config, { logger: false })).rejects.toThrow(
      'EXTERNAL_STORES_REQUIRED',
    );
  });
});
