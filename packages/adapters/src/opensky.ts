import { z } from 'zod';

import type { ProviderFlight } from '@hangban/domain';

import { fetchJson } from './http-provider';
import type { OpenSkyTokenManager } from './opensky-token';
import { ProviderError, type FlightPositionProvider } from './provider';

const responseSchema = z.object({
  time: z.number().positive().max(8_640_000_000_000),
  states: z.array(z.array(z.unknown())).nullable(),
});

const icao24Schema = z.string().regex(/^[0-9a-f]{6}$/i);

function optionalNonnegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function optionalHeading(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360
    ? value
    : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createOpenSkyProvider(
  options: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    timeoutMs?: number;
    tokenManager?: OpenSkyTokenManager;
  } = {},
): FlightPositionProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'https://opensky-network.org/api';
  return {
    providerId: 'opensky',
    async fetchSnapshot(scope) {
      const [west, south, east, north] = scope.bbox;
      if (west > east)
        throw new ProviderError(
          'INVALID_RESPONSE',
          'OpenSky scope must not cross the antimeridian',
        );
      const lease = await options.tokenManager?.getTokenLease();
      const raw = await fetchJson({
        fetchImpl,
        url: `${baseUrl}/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(lease ? { headers: { Authorization: `Bearer ${lease.token}` } } : {}),
        ...(options.tokenManager
          ? {
              retryUnauthorized: async () => {
                options.tokenManager!.invalidate(lease);
                const replacement = await options.tokenManager!.getTokenLease();
                return { Authorization: `Bearer ${replacement.token}` };
              },
            }
          : {}),
      });
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success)
        throw new ProviderError('INVALID_RESPONSE', 'OpenSky response failed validation');
      const observedAt = new Date(parsed.data.time * 1_000).toISOString();
      const flights: ProviderFlight[] = (parsed.data.states ?? []).flatMap((state) => {
        const icao24 = icao24Schema.safeParse(state[0]);
        const callsign = z.string().trim().min(2).safeParse(state[1]);
        const longitude = z.number().min(-180).max(180).safeParse(state[5]);
        const latitude = z.number().min(-90).max(90).safeParse(state[6]);
        if (!icao24.success || !callsign.success || !longitude.success || !latitude.success)
          return [];
        const velocity = optionalNonnegativeNumber(state[9]);
        const verticalRate = optionalNumber(state[11]);
        return [
          {
            providerId: 'opensky',
            icao24: icao24.data,
            callsign: callsign.data,
            latitude: latitude.data,
            longitude: longitude.data,
            altitudeM: state[8] === true ? 0 : optionalNonnegativeNumber(state[7]),
            groundSpeedKmh: velocity === null ? null : Math.round(velocity * 3.6),
            headingDeg: optionalHeading(state[10]),
            verticalRateMpm: verticalRate === null ? null : Math.round(verticalRate * 60),
            observedAt,
          },
        ];
      });
      return { providerId: 'opensky', observedAt, flights };
    },
  };
}
