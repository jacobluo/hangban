import { flightSchema, type Flight } from '@hangban/contracts';

import { classifyFreshness } from './freshness';

export type ProviderFlight = {
  providerId: string;
  icao24: string;
  callsign: string;
  latitude: number;
  longitude: number;
  altitudeM?: number | null;
  groundSpeedKmh?: number | null;
  headingDeg?: number | null;
  verticalRateMpm?: number | null;
  observedAt: string;
  registration?: string;
  aircraftType?: string;
  origin?: string;
  destination?: string;
};

export function normalizeProviderFlight(candidate: ProviderFlight, now: Date = new Date()): Flight {
  return flightSchema.parse({
    id: `icao-${candidate.icao24.toLowerCase()}`,
    icao24: candidate.icao24.toLowerCase(),
    callsign: candidate.callsign.trim(),
    registration: candidate.registration,
    aircraftType: candidate.aircraftType,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    altitudeM: candidate.altitudeM ?? null,
    groundSpeedKmh: candidate.groundSpeedKmh ?? null,
    headingDeg: candidate.headingDeg ?? null,
    verticalRateMpm: candidate.verticalRateMpm ?? null,
    observedAt: candidate.observedAt,
    freshness: classifyFreshness(candidate.observedAt, now),
    confidence: 0.75,
    sources: [candidate.providerId],
    origin: candidate.origin,
    destination: candidate.destination,
    inferredFields: [],
  });
}
