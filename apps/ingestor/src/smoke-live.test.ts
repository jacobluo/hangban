import { ProviderError, type FlightPositionProvider } from '@hangban/adapters';
import type { CollectionScope } from '@hangban/ingestion';
import { describe, expect, it, vi } from 'vitest';

import {
  handleSmokeCliFailure,
  type LiveSmokeSummary,
  NoLiveProviderSucceededError,
  runSmokeCli,
  smokeLive,
} from './smoke-live';

const scope: CollectionScope = {
  bbox: [115, 35, 120, 40],
  latitude: 37.5,
  longitude: 117.5,
  radiusNm: 212,
  cacheKey: 'first-scope',
};
const observedAt = '2026-07-12T08:00:00.000Z';

function provider(
  providerId: string,
  outcome: 'success' | 'failure',
  records = 0,
): FlightPositionProvider {
  return {
    providerId,
    async fetchSnapshot() {
      if (outcome === 'failure') throw new ProviderError('TIMEOUT', 'credential=hidden');
      return {
        providerId,
        observedAt,
        flights: Array.from({ length: records }, (_, index) => ({
          providerId,
          icao24: index.toString(16).padStart(6, '0'),
          callsign: `TEST${index}`,
          latitude: 37.5,
          longitude: 117.5,
          altitudeM: 1_000,
          groundSpeedKmh: 500,
          headingDeg: 90,
          verticalRateMpm: 0,
          observedAt,
        })),
      };
    },
  };
}

describe('smokeLive', () => {
  it('fails with a stable code when no real upstream request succeeds', async () => {
    await expect(
      smokeLive({ providers: [provider('adsb-lol', 'failure')], scope }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'NO_LIVE_PROVIDER_SUCCEEDED',
        summary: expect.objectContaining({
          providers: [{ providerId: 'adsb-lol', state: 'down', records: 0, errorCode: 'TIMEOUT' }],
        }),
      }),
    );
  });

  it('fails when every successful upstream response contains zero parsed records', async () => {
    await expect(
      smokeLive({
        providers: [provider('adsb-lol', 'failure'), provider('opensky', 'success')],
        scope,
        now: () => new Date(observedAt),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'NO_LIVE_PROVIDER_SUCCEEDED',
        summary: expect.objectContaining({
          providers: [
            { providerId: 'adsb-lol', state: 'down', records: 0, errorCode: 'TIMEOUT' },
            { providerId: 'opensky', state: 'healthy', records: 0 },
          ],
        }),
      }),
    );
  });

  it('reports every provider and succeeds when one provider parses records', async () => {
    const result = await smokeLive({
      providers: [provider('adsb-lol', 'success'), provider('opensky', 'success', 1)],
      scope,
      now: () => new Date(observedAt),
    });

    expect(result).toEqual({
      event: 'ingestion.smoke',
      observedAt,
      providers: [
        { providerId: 'adsb-lol', state: 'healthy', records: 0 },
        { providerId: 'opensky', state: 'healthy', records: 1 },
      ],
    });
  });

  it('does not allow an empty provider set to pass', async () => {
    await expect(smokeLive({ providers: [], scope })).rejects.toBeInstanceOf(
      NoLiveProviderSucceededError,
    );
  });
});

describe('smoke CLI boundary', () => {
  it('maps only the expected no-provider error to its specific stable code', async () => {
    const writeSummary = vi.fn().mockResolvedValue(undefined);
    const writeError = vi.fn().mockResolvedValue(undefined);
    const setExitCode = vi.fn();
    const summary: LiveSmokeSummary = { event: 'ingestion.smoke', observedAt, providers: [] };
    await handleSmokeCliFailure(new NoLiveProviderSucceededError(summary), {
      writeSummary,
      writeError,
      setExitCode,
    });
    expect(writeSummary).toHaveBeenCalledWith(summary);
    expect(writeError).toHaveBeenCalledWith({
      event: 'ingestion.smoke.failed',
      code: 'NO_LIVE_PROVIDER_SUCCEEDED',
    });
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('classifies configuration and programming failures generically without leaking details', async () => {
    const writeError = vi.fn().mockResolvedValue(undefined);
    await handleSmokeCliFailure(new Error('secret=https://hidden.invalid'), {
      writeSummary: vi.fn(),
      writeError,
      setExitCode: vi.fn(),
    });
    expect(writeError).toHaveBeenCalledWith({
      event: 'ingestion.smoke.failed',
      code: 'INGESTION_SMOKE_FAILED',
    });
    expect(JSON.stringify(writeError.mock.calls)).not.toContain('hidden.invalid');
  });

  it('passes only the first planned scope to the live smoke', async () => {
    const smokeImpl = vi.fn().mockResolvedValue({
      event: 'ingestion.smoke',
      observedAt,
      providers: [],
    });
    const writeSummary = vi.fn().mockResolvedValue(undefined);
    await runSmokeCli(
      {
        DATA_MODE: 'live',
        LIVE_PROVIDERS: 'adsb-lol',
        LIVE_DEFAULT_BBOXES: '115,35,120,40;0,0,5,5',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
        REDIS_URL: 'redis://:test@127.0.0.1:6379',
      },
      {
        createProviders: () => [provider('adsb-lol', 'success')],
        smokeImpl,
        writeSummary,
      },
    );
    expect(smokeImpl).toHaveBeenCalledOnce();
    expect(smokeImpl.mock.calls[0]![0].scope.bbox).toEqual([115, 35, 120, 40]);
    expect(writeSummary).toHaveBeenCalledOnce();
  });

  it('rejects invalid configuration and duplicate providers as generic boundary failures', async () => {
    const invalidConfig = await runSmokeCli({ DATA_MODE: 'invalid' }).catch(
      (error: unknown) => error,
    );
    const duplicateProvider = provider('duplicate', 'success');
    const duplicate = await smokeLive({
      providers: [duplicateProvider, duplicateProvider],
      scope,
    }).catch((error: unknown) => error);
    for (const error of [invalidConfig, duplicate]) {
      const writeError = vi.fn().mockResolvedValue(undefined);
      await handleSmokeCliFailure(error, {
        writeError,
        writeSummary: vi.fn(),
        setExitCode: vi.fn(),
      });
      expect(writeError).toHaveBeenCalledWith({
        event: 'ingestion.smoke.failed',
        code: 'INGESTION_SMOKE_FAILED',
      });
    }
  });
});
