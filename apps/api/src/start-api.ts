import type { RuntimeConfig } from '@hangban/config';
import type { Airport } from '@hangban/contracts';
import type { GeoCityRecord } from '@hangban/adapters';

import { createApiRuntime } from './app';
import { createExternalApiRuntime } from './external-runtime';

type StartableApp = {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
  log: { error(message: string): void };
};

type StartApiOptions = {
  config: RuntimeConfig;
  airports?: Airport[];
  createRuntime?: (options: {
    config: RuntimeConfig;
    airports: Airport[];
    cities?: GeoCityRecord[];
  }) => {
    app: StartableApp;
  };
  createExternalRuntime?: (config: RuntimeConfig) => Promise<{ app: StartableApp }>;
  setExitCode?: (code: number) => void;
  logStartupError?: (message: string) => void;
};

export async function startApi({
  config,
  airports,
  createRuntime = createApiRuntime,
  createExternalRuntime = createExternalApiRuntime,
  setExitCode = (code) => {
    process.exitCode = code;
  },
  logStartupError = console.error,
}: StartApiOptions): Promise<StartableApp | null> {
  let app: StartableApp;
  try {
    if (config.dataMode === 'live') {
      app = (await createExternalRuntime(config)).app;
    } else {
      app = createRuntime({ config, airports: airports ?? [] }).app;
    }
  } catch {
    logStartupError('API startup failed: external stores are unavailable');
    setExitCode(1);
    return null;
  }
  try {
    await app.listen({ host: config.apiHost, port: config.apiPort });
    return app;
  } catch {
    try {
      await app.close();
    } catch {
      // Startup failure remains authoritative; shutdown details may contain sensitive internals.
    } finally {
      app.log.error('API startup failed');
      setExitCode(1);
    }
    return null;
  }
}
