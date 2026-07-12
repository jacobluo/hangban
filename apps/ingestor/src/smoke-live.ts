import { pathToFileURL } from 'node:url';

import { createLiveProviders, type FlightPositionProvider } from '@hangban/adapters';
import { loadConfig } from '@hangban/config';
import {
  createProviderScheduler,
  planScopes,
  runCycle,
  type CollectionScope,
} from '@hangban/ingestion';

import { writeJsonError, writeJsonLine } from './index';

export class NoLiveProviderSucceededError extends Error {
  readonly code = 'NO_LIVE_PROVIDER_SUCCEEDED' as const;

  constructor(public readonly summary?: LiveSmokeSummary) {
    super('No live provider succeeded');
    this.name = 'NoLiveProviderSucceededError';
  }
}

export type LiveSmokeSummary = {
  event: 'ingestion.smoke';
  observedAt: string;
  providers: Array<{
    providerId: string;
    state: 'healthy' | 'degraded' | 'down';
    records: number;
    errorCode?: string;
  }>;
};

export async function smokeLive({
  providers,
  scope,
  now = () => new Date(),
}: {
  providers: FlightPositionProvider[];
  scope: CollectionScope;
  now?: () => Date;
}): Promise<LiveSmokeSummary> {
  const scheduler = createProviderScheduler({
    policies: Object.fromEntries(
      providers.map(({ providerId }) => [
        providerId,
        { minIntervalMs: 0, cacheTtlMs: 0, maxBackoffMs: 1_000 },
      ]),
    ),
    now,
  });
  const result = await runCycle({
    providers,
    scopes: [scope],
    previousFlights: [],
    previousStatuses: [],
    scheduler,
    now,
  });
  const summary: LiveSmokeSummary = {
    event: 'ingestion.smoke',
    observedAt: result.observedAt,
    providers: result.statuses.map((status) => ({
      providerId: status.providerId,
      state: status.state,
      records: status.lastRecordCount ?? 0,
      ...(status.errorCode === undefined ? {} : { errorCode: status.errorCode }),
    })),
  };
  const parsedRecordCount = summary.providers.reduce(
    (total, provider) => total + provider.records,
    0,
  );
  if (result.successfulProviders === 0 || parsedRecordCount === 0) {
    throw new NoLiveProviderSucceededError(summary);
  }
  return summary;
}

export async function runSmokeCli(
  environment: Record<string, string | undefined> = process.env,
  dependencies: {
    createProviders?: typeof createLiveProviders;
    smokeImpl?: typeof smokeLive;
    writeSummary?: (summary: LiveSmokeSummary) => void | Promise<void>;
  } = {},
): Promise<void> {
  const config = loadConfig(environment);
  if (config.dataMode !== 'live') throw new NoLiveProviderSucceededError();
  const scope = planScopes(config.liveDefaultBboxes, { maxScopes: 1 })[0];
  if (scope === undefined) throw new NoLiveProviderSucceededError();
  const summary = await (dependencies.smokeImpl ?? smokeLive)({
    providers: (dependencies.createProviders ?? createLiveProviders)(config),
    scope,
  });
  await (dependencies.writeSummary ?? writeJsonLine)(summary);
}

export async function handleSmokeCliFailure(
  error: unknown,
  dependencies: {
    writeSummary?: (summary: LiveSmokeSummary) => void | Promise<void>;
    writeError?: (error: unknown) => void | Promise<void>;
    setExitCode?: (code: number) => void;
  } = {},
): Promise<void> {
  const writeSummary = dependencies.writeSummary ?? writeJsonLine;
  const writeError = dependencies.writeError ?? writeJsonError;
  dependencies.setExitCode?.(1);
  if (dependencies.setExitCode === undefined) process.exitCode = 1;

  if (error instanceof NoLiveProviderSucceededError) {
    if (error.summary !== undefined) {
      try {
        await writeSummary(error.summary);
      } catch {
        // Continue to the stable failure record when stdout is unavailable.
      }
    }
    try {
      await writeError({
        event: 'ingestion.smoke.failed',
        code: 'NO_LIVE_PROVIDER_SUCCEEDED',
      });
    } catch {
      // A closed stderr must not create an unhandled rejection.
    }
    return;
  }

  try {
    await writeError({
      event: 'ingestion.smoke.failed',
      code: 'INGESTION_SMOKE_FAILED',
    });
  } catch {
    // A closed stderr must not create an unhandled rejection.
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  void runSmokeCli().catch(handleSmokeCliFailure);
}
