import { describe, expect, it, vi } from 'vitest';

import { createLiveProviders } from './provider-factory';

const baseConfig = {
  liveProviders: ['adsb-lol', 'airplanes-live', 'opensky'] as const,
  adsbLolBaseUrl: 'https://adsb.test/v2',
  airplanesLiveBaseUrl: 'https://airplanes.test/v2',
  openSkyBaseUrl: 'https://opensky.test/api',
  openSkyTokenUrl: 'https://auth.test/token',
  providerTimeoutMs: 5_000,
};

describe('createLiveProviders', () => {
  it('creates only the configured live providers in configured order', () => {
    const providers = createLiveProviders({
      ...baseConfig,
      liveProviders: ['adsb-lol', 'opensky'],
    });

    expect(providers.map((provider) => provider.providerId)).toEqual(['adsb-lol', 'opensky']);
  });

  it('creates an anonymous OpenSky provider when credentials are absent', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ time: 1_783_756_800, states: [] }), { status: 200 }),
      );
    const [provider] = createLiveProviders(
      { ...baseConfig, liveProviders: ['opensky'] },
      { fetchImpl, now: () => new Date('2026-07-11T08:00:00.000Z') },
    );

    await provider!.fetchSnapshot({ bbox: [100, 20, 101, 21] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).not.toMatchObject({
      headers: expect.objectContaining({ Authorization: expect.anything() }),
    });
  });

  it('shares OAuth token authentication with the configured OpenSky provider', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'test-token', expires_in: 300, token_type: 'Bearer' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ time: 1_783_756_800, states: [] }), { status: 200 }),
      );
    const [provider] = createLiveProviders(
      {
        ...baseConfig,
        liveProviders: ['opensky'],
        openSkyClientId: 'server-client',
        openSkyClientSecret: 'server-secret',
      },
      { fetchImpl, now: () => new Date('2026-07-11T08:00:00.000Z') },
    );

    await provider!.fetchSnapshot({ bbox: [100, 20, 101, 21] });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('rejects incomplete OpenSky credentials at the factory boundary', () => {
    expect(() =>
      createLiveProviders({
        ...baseConfig,
        liveProviders: ['opensky'],
        openSkyClientId: 'server-client',
      }),
    ).toThrow('OpenSky client ID and client secret must be configured together');
  });

  it('rejects an unknown provider at runtime instead of returning an invalid entry', () => {
    expect(() =>
      createLiveProviders({
        ...baseConfig,
        liveProviders: ['unknown-provider'],
      } as never),
    ).toThrow('Unsupported live provider: unknown-provider');
  });

  it('rejects duplicate provider IDs defensively', () => {
    expect(() =>
      createLiveProviders({
        ...baseConfig,
        liveProviders: ['adsb-lol', 'adsb-lol'],
      }),
    ).toThrow('Duplicate live provider: adsb-lol');
  });
});
