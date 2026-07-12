import { z } from 'zod';

import type { ProviderFlight } from '@hangban/domain';

import { ProviderError, type GeoScope, type ProviderSnapshot } from './provider';

const nullableNumber = z.number().nullable().optional().catch(null);
const nullableString = z.string().nullable().optional().catch(null);

const aircraftSchema = z.object({
  hex: nullableString,
  flight: nullableString,
  lat: nullableNumber,
  lon: nullableNumber,
  alt_baro: z.union([z.number(), z.string()]).nullable().optional().catch(null),
  gs: nullableNumber,
  track: nullableNumber,
  baro_rate: nullableNumber,
  r: nullableString,
  t: nullableString,
});

const responseEnvelopeSchema = z.object({
  now: z.number().finite(),
  ac: z.array(z.unknown()),
});

export function normalizeEpoch(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Invalid epoch');
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid epoch');
  return date.toISOString();
}

export function parseReadsbSnapshot(providerId: string, raw: unknown): ProviderSnapshot {
  const parsed = responseEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError('INVALID_RESPONSE', 'Readsb response failed validation');
  }

  let observedAt: string;
  try {
    observedAt = normalizeEpoch(parsed.data.now);
  } catch {
    throw new ProviderError('INVALID_RESPONSE', 'Readsb response has an invalid timestamp');
  }

  const flights: ProviderFlight[] = parsed.data.ac.flatMap((candidate) => {
    const aircraftResult = aircraftSchema.safeParse(candidate);
    if (!aircraftResult.success) return [];
    const aircraft = aircraftResult.data;
    const callsign = aircraft.flight?.trim();
    if (
      !aircraft.hex ||
      !/^[a-fA-F0-9]{6}$/.test(aircraft.hex) ||
      !callsign ||
      callsign.length < 2 ||
      aircraft.lat === null ||
      aircraft.lat === undefined ||
      aircraft.lat < -90 ||
      aircraft.lat > 90 ||
      aircraft.lon === null ||
      aircraft.lon === undefined ||
      aircraft.lon < -180 ||
      aircraft.lon > 180
    ) {
      return [];
    }

    const altitudeM =
      aircraft.alt_baro === 'ground'
        ? 0
        : typeof aircraft.alt_baro === 'number' && aircraft.alt_baro >= 0
          ? Math.round(aircraft.alt_baro * 0.3048)
          : null;

    return [
      {
        providerId,
        icao24: aircraft.hex,
        callsign,
        latitude: aircraft.lat,
        longitude: aircraft.lon,
        altitudeM,
        groundSpeedKmh:
          aircraft.gs == null || aircraft.gs < 0 ? null : Math.round(aircraft.gs * 1.852),
        headingDeg:
          aircraft.track == null || aircraft.track < 0 || aircraft.track >= 360
            ? null
            : aircraft.track,
        verticalRateMpm:
          aircraft.baro_rate == null ? null : Math.round(aircraft.baro_rate * 0.3048),
        observedAt,
        ...(aircraft.r?.trim() ? { registration: aircraft.r.trim() } : {}),
        ...(aircraft.t?.trim() ? { aircraftType: aircraft.t.trim() } : {}),
      },
    ];
  });

  return { providerId, observedAt, flights };
}

function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function distanceNauticalMiles(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * radians;
  const longitudeDelta = normalizeLongitude(longitudeB - longitudeA) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA * radians) *
      Math.cos(latitudeB * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 3_440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function readsbPointFromScope(scope: GeoScope): {
  latitude: number;
  longitude: number;
  radiusNm: number;
} {
  const [west, south, east, north] = scope.bbox;
  const latitude = (south + north) / 2;
  const rawSpan = east - west;
  const eastwardSpan = Math.abs(rawSpan) >= 360 ? 360 : ((rawSpan % 360) + 360) % 360;
  const longitude = normalizeLongitude(west + eastwardSpan / 2);
  const radiusNm = Math.min(
    250,
    Math.max(
      1,
      Math.ceil(
        Math.max(
          distanceNauticalMiles(latitude, longitude, south, west),
          distanceNauticalMiles(latitude, longitude, north, east),
        ),
      ),
    ),
  );
  return { latitude, longitude, radiusNm };
}
