import { describe, expect, it, vi } from 'vitest';

import { createAdsbLolProvider } from './adsb-lol';
import { createAirplanesLiveProvider } from './airplanes-live';
import { createDemoProvider } from './demo';
import { createOpenSkyProvider } from './opensky';
import { createOpenSkyTokenManager, type OpenSkyTokenManager } from './opensky-token';
import type { GeoScope } from './provider';

const scope: GeoScope = { bbox: [-180, -90, 180, 90] };

describe('ADSB.lol provider', () => {
  it('converts rate limiting into a stable provider error', async () => {
    const provider = createAdsbLolProvider({
      fetchImpl: async () => new Response('', { status: 429 }),
    });

    await expect(provider.fetchSnapshot(scope)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('parses a valid aircraft response', async () => {
    const provider = createAdsbLolProvider({
      fetchImpl: async () =>
        Response.json({
          now: 1_783_756_800,
          ac: [
            {
              hex: '780001',
              flight: 'CA981 ',
              lat: 40,
              lon: 116,
              alt_baro: 35000,
              gs: 500,
              track: 68,
              baro_rate: 100,
            },
          ],
        }),
    });

    const snapshot = await provider.fetchSnapshot(scope);
    expect(snapshot.flights[0]).toMatchObject({ callsign: 'CA981', altitudeM: 10_668 });
  });

  it('uses the readsb lat/lon endpoint and passes the configured timeout', async () => {
    let requestedUrl: string | undefined;
    let signal: AbortSignal | null | undefined;
    const provider = createAdsbLolProvider({
      baseUrl: 'https://api.adsb.lol/v2',
      timeoutMs: 321,
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        signal = init?.signal;
        return Response.json({ now: 1_783_756_800, ac: [] });
      },
    });

    const snapshot = await provider.fetchSnapshot(scope);

    expect(requestedUrl).toBe('https://api.adsb.lol/v2/lat/0/lon/0/dist/250');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(snapshot.providerId).toBe('adsb-lol');
  });
});

describe('Airplanes.live provider', () => {
  it('uses its independent point endpoint and preserves parsed provider fields', async () => {
    let requestedUrl: string | undefined;
    const provider = createAirplanesLiveProvider({
      baseUrl: 'https://api.airplanes.live/v2',
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return Response.json({
          now: 1_783_756_800_000,
          ac: [
            {
              hex: '780001',
              flight: ' CA981 ',
              lat: 40,
              lon: 116,
              alt_baro: 'ground',
              r: 'B-2482',
              t: 'B748',
            },
          ],
        });
      },
    });

    const snapshot = await provider.fetchSnapshot(scope);

    expect(requestedUrl).toBe('https://api.airplanes.live/v2/point/0/0/250');
    expect(snapshot.providerId).toBe('airplanes-live');
    expect(snapshot.flights[0]).toMatchObject({
      providerId: 'airplanes-live',
      callsign: 'CA981',
      altitudeM: 0,
      registration: 'B-2482',
      aircraftType: 'B748',
    });
  });
});

describe('OpenSky provider', () => {
  const openSkyScope: GeoScope = { bbox: [100, 20, 130, 50] };
  const validResponse = {
    time: 1_783_756_800,
    states: [['780001', ' CA981 ', null, null, null, 116, 40, 1_000, false, 100, 359.5, -2]],
  };

  it('sends no Authorization header for anonymous requests', async () => {
    let authorization: string | null | undefined;
    const provider = createOpenSkyProvider({
      fetchImpl: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return Response.json(validResponse);
      },
    });

    await provider.fetchSnapshot(openSkyScope);
    expect(authorization).toBeNull();
  });

  it('sends the injected bearer token', async () => {
    let authorization: string | null | undefined;
    const tokenManager: OpenSkyTokenManager = {
      getToken: async () => 'token-a',
      getTokenLease: async () => ({ token: 'token-a', generation: 0 }),
      invalidate() {},
    };
    const provider = createOpenSkyProvider({
      tokenManager,
      fetchImpl: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return Response.json(validResponse);
      },
    });

    await provider.fetchSnapshot(openSkyScope);
    expect(authorization).toBe('Bearer token-a');
  });

  it('invalidates and retries once with a refreshed token after 401', async () => {
    const requests: Array<string | null> = [];
    let invalidations = 0;
    let token = 'token-a';
    const tokenManager: OpenSkyTokenManager = {
      getToken: async () => token,
      getTokenLease: async () => ({ token, generation: invalidations }),
      invalidate() {
        invalidations += 1;
        token = 'token-b';
      },
    };
    const provider = createOpenSkyProvider({
      tokenManager,
      fetchImpl: async (_input, init) => {
        requests.push(new Headers(init?.headers).get('authorization'));
        return requests.length === 1
          ? new Response('', { status: 401 })
          : Response.json(validResponse);
      },
    });

    await provider.fetchSnapshot(openSkyScope);
    expect(requests).toEqual(['Bearer token-a', 'Bearer token-b']);
    expect(invalidations).toBe(1);
  });

  it('coalesces concurrent 401 refreshes without clearing the replacement token', async () => {
    const tokenFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token-a', expires_in: 1_800, token_type: 'Bearer' }),
      )
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token-b', expires_in: 1_800, token_type: 'Bearer' }),
      );
    const tokenManager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl: tokenFetch,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });
    const authorizations: string[] = [];
    const provider = createOpenSkyProvider({
      tokenManager,
      fetchImpl: async (_input, init) => {
        const authorization = new Headers(init?.headers).get('authorization')!;
        authorizations.push(authorization);
        return authorization === 'Bearer token-a'
          ? new Response('', { status: 401 })
          : Response.json(validResponse);
      },
    });

    await Promise.all([provider.fetchSnapshot(openSkyScope), provider.fetchSnapshot(openSkyScope)]);

    expect(authorizations.filter((value) => value === 'Bearer token-b')).toHaveLength(2);
    expect(await tokenManager.getToken()).toBe('token-b');
    expect(tokenFetch).toHaveBeenCalledTimes(2);
  });

  it('drops malformed states and converts nullable and motion fields', async () => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () =>
        Response.json({
          time: 1_783_756_800,
          states: [
            ['bad', 'X', null, null, null, 116, 40],
            ['780001', ' CA981 ', null, null, null, 116, 40, null, false, null, null, null],
            ['780002', 'MU5102', null, null, null, 121, 31, 900, true, 100, 0, -2],
          ],
        }),
    });

    const snapshot = await provider.fetchSnapshot(openSkyScope);
    expect(snapshot.observedAt).toBe('2026-07-11T08:00:00.000Z');
    expect(snapshot.flights).toHaveLength(2);
    expect(snapshot.flights[0]).toMatchObject({
      altitudeM: null,
      groundSpeedKmh: null,
      headingDeg: null,
      verticalRateMpm: null,
    });
    expect(snapshot.flights[1]).toMatchObject({
      altitudeM: 0,
      groundSpeedKmh: 360,
      headingDeg: 0,
      verticalRateMpm: -120,
    });
  });

  it('drops states with out-of-range coordinates without failing valid states', async () => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () =>
        Response.json({
          time: 1_783_756_800,
          states: [
            ['780001', 'CA981', null, null, null, 116, 40, -10, false, null, null, null],
            ['780002', 'MU5102', null, null, null, 181, 40, 900, false, null, null, null],
            ['780003', 'CZ3101', null, null, null, 116, 91, 900, false, null, null, null],
          ],
        }),
    });

    const snapshot = await provider.fetchSnapshot(openSkyScope);

    expect(snapshot.flights).toHaveLength(1);
    expect(snapshot.flights[0]).toMatchObject({ icao24: '780001', altitudeM: null });
  });

  it('rejects antimeridian-crossing scopes for the scope planner to split', async () => {
    const provider = createOpenSkyProvider({ fetchImpl: async () => Response.json(validResponse) });

    await expect(provider.fetchSnapshot({ bbox: [170, -20, -170, 20] })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('maps an unrepresentable response epoch to INVALID_RESPONSE', async () => {
    const provider = createOpenSkyProvider({
      fetchImpl: async () => Response.json({ time: Number.MAX_VALUE, states: [] }),
    });

    await expect(provider.fetchSnapshot(openSkyScope)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'OpenSky response failed validation',
    });
  });
});

describe('demo provider', () => {
  it('returns deterministic canonical provider flights', async () => {
    const provider = createDemoProvider(new Date('2026-07-11T08:00:00.000Z'));
    const first = await provider.fetchSnapshot(scope);
    const second = await provider.fetchSnapshot(scope);
    expect(second).toEqual(first);
    expect(first.flights.length).toBeGreaterThan(4);
  });
});
