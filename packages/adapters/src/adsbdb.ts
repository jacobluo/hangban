import { z } from 'zod';

export type AircraftMetadata = {
  providerId: 'adsbdb';
  icao24: string;
  registration?: string;
  aircraftType?: string;
  manufacturer?: string;
};
export type CallsignMetadata = {
  providerId: 'adsbdb';
  callsign: string;
  airline?: string;
  origin?: string;
  destination?: string;
  inferred: true;
};
export interface FlightMetadataProvider {
  readonly providerId: string;
  fetchAircraft(icao24: string): Promise<AircraftMetadata>;
  fetchCallsign(callsign: string): Promise<CallsignMetadata>;
}
export class MetadataProviderError extends Error {
  constructor(
    public readonly code:
      'NOT_FOUND' | 'RATE_LIMITED' | 'INVALID_RESPONSE' | 'UPSTREAM_ERROR' | 'INVALID_IDENTIFIER',
    public readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'MetadataProviderError';
  }
}

const aircraftEnvelope = z.object({
  response: z.object({
    aircraft: z.object({
      mode_s: z.string(),
      registration: z.string().optional(),
      icao_type: z.string().optional(),
      manufacturer: z.string().optional(),
    }),
  }),
});
const routeEnvelope = z.object({
  response: z.object({
    flightroute: z.object({
      airline: z.object({ name: z.string() }).optional(),
      origin: z.object({ iata_code: z.string().length(3) }).optional(),
      destination: z.object({ iata_code: z.string().length(3) }).optional(),
    }),
  }),
});

export function createAdsbdbProvider({
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = 5_000,
}: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): FlightMetadataProvider {
  const request = async (path: string) => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new MetadataProviderError('UPSTREAM_ERROR');
    }
    if (response.status === 404) throw new MetadataProviderError('NOT_FOUND');
    if (response.status === 429)
      throw new MetadataProviderError(
        'RATE_LIMITED',
        Number(response.headers.get('retry-after') ?? 0) * 1_000 || undefined,
      );
    if (!response.ok) throw new MetadataProviderError('UPSTREAM_ERROR');
    try {
      return await response.json();
    } catch {
      throw new MetadataProviderError('INVALID_RESPONSE');
    }
  };
  return {
    providerId: 'adsbdb',
    async fetchAircraft(icao24) {
      const normalized = icao24.trim().toUpperCase();
      if (!/^[A-F0-9]{6}$/.test(normalized)) throw new MetadataProviderError('INVALID_IDENTIFIER');
      const parsed = aircraftEnvelope.safeParse(
        await request(`aircraft/${encodeURIComponent(normalized)}`),
      );
      if (!parsed.success) throw new MetadataProviderError('INVALID_RESPONSE');
      const a = parsed.data.response.aircraft;
      return {
        providerId: 'adsbdb',
        icao24: normalized.toLowerCase(),
        ...(a.registration ? { registration: a.registration } : {}),
        ...(a.icao_type ? { aircraftType: a.icao_type } : {}),
        ...(a.manufacturer ? { manufacturer: a.manufacturer } : {}),
      };
    },
    async fetchCallsign(callsign) {
      const normalized = callsign.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,12}$/.test(normalized))
        throw new MetadataProviderError('INVALID_IDENTIFIER');
      const parsed = routeEnvelope.safeParse(
        await request(`callsign/${encodeURIComponent(normalized)}`),
      );
      if (!parsed.success) throw new MetadataProviderError('INVALID_RESPONSE');
      const r = parsed.data.response.flightroute;
      return {
        providerId: 'adsbdb',
        callsign: normalized,
        ...(r.airline ? { airline: r.airline.name } : {}),
        ...(r.origin ? { origin: r.origin.iata_code } : {}),
        ...(r.destination ? { destination: r.destination.iata_code } : {}),
        inferred: true,
      };
    },
  };
}
