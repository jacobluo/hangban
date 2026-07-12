import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '@hangban/config';

import { startApi } from './start-api';

describe('startApi', () => {
  it('uses external stores in live mode without loading local airport files', async () => {
    const order: string[] = [];
    const app = {
      listen: async () => {
        order.push('listen');
      },
      close: async () => {},
      log: { error: vi.fn() },
    };

    await startApi({
      config: loadConfig({
        DATA_MODE: 'live',
        LIVE_PROVIDERS: 'adsb-lol',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
        REDIS_URL: 'redis://:test@127.0.0.1:6379',
      }),
      createExternalRuntime: async () => {
        order.push('runtime');
        return { app };
      },
    });

    expect(order).toEqual(['runtime', 'listen']);
  });

  it('fails live startup with a safe message when external stores fail', async () => {
    const errors: string[] = [];
    const createRuntime = vi.fn();
    const result = await startApi({
      config: loadConfig({
        DATA_MODE: 'live',
        LIVE_PROVIDERS: 'adsb-lol',
        DATABASE_URL: 'postgresql://test:secret@127.0.0.1/test',
        REDIS_URL: 'redis://:secret@127.0.0.1:6379',
      }),
      createExternalRuntime: async () => {
        throw new Error('raw connection content with secret');
      },
      createRuntime,
      logStartupError: (message) => errors.push(message),
      setExitCode: (code) => errors.push(`exit:${code}`),
    });

    expect(result).toBeNull();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(errors).toEqual(['API startup failed: external stores are unavailable', 'exit:1']);
    expect(errors.join(' ')).not.toContain('secret');
  });

  it('awaits app.close before logging and setting the exit code when listen fails', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const timer = setInterval(() => order.push('timer'), 10);
    const app = {
      listen: vi.fn(async () => {
        order.push('listen');
        throw new Error('address and secret detail');
      }),
      close: vi.fn(async () => {
        order.push('close:start');
        await Promise.resolve();
        clearInterval(timer);
        order.push('close:end');
      }),
      log: { error: vi.fn(() => order.push('log')) },
    };

    await startApi({
      config: loadConfig({ DATA_MODE: 'demo' }),
      airports: [],
      createRuntime: () => ({ app }),
      setExitCode: () => order.push('exit'),
    });

    expect(order).toEqual(['listen', 'close:start', 'close:end', 'log', 'exit']);
    expect(app.log.error).toHaveBeenCalledWith('API startup failed');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('still logs a fixed message and sets exit code when listen and close both fail', async () => {
    const order: string[] = [];
    const app = {
      listen: async () => {
        order.push('listen');
        throw new Error('listen secret');
      },
      close: async () => {
        order.push('close');
        throw new Error('close secret');
      },
      log: { error: vi.fn((message: string) => order.push(`log:${message}`)) },
    };
    const result = await startApi({
      config: loadConfig({ DATA_MODE: 'demo' }),
      airports: [],
      createRuntime: () => ({ app }),
      setExitCode: (code) => order.push(`exit:${code}`),
    });
    expect(result).toBeNull();
    expect(order).toEqual(['listen', 'close', 'log:API startup failed', 'exit:1']);
    expect(order.join(' ')).not.toContain('secret');
  });
});
