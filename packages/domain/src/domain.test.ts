import { describe, expect, it } from 'vitest';

import type { Flight } from '@hangban/contracts';

import { classifyFreshness } from './freshness';
import { fuseFlights } from './fusion';
import { normalizeProviderFlight } from './normalize';
import { distanceKm, isInsideBbox, nearbyFlights } from './spatial';
import { matchRouteFlights } from './routes';

const now = new Date('2026-07-11T08:00:30.000Z');

function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'icao-780001',
    icao24: '780001',
    callsign: 'CA981',
    latitude: 40,
    longitude: 116,
    altitudeM: 10_000,
    groundSpeedKmh: 800,
    headingDeg: 68,
    verticalRateMpm: 0,
    observedAt: '2026-07-11T08:00:20.000Z',
    freshness: 'live',
    confidence: 0.8,
    sources: ['opensky'],
    origin: 'PEK',
    destination: 'JFK',
    inferredFields: [],
    fieldSources: [],
    ...overrides,
  };
}

describe('freshness', () => {
  it('classifies positions older than two minutes as stale', () => {
    expect(classifyFreshness('2026-07-11T07:58:00.000Z', now)).toBe('stale');
  });
});

describe('provider normalization', () => {
  it('maps registration and aircraft type into the canonical flight', () => {
    const result = normalizeProviderFlight(
      {
        providerId: 'airplanes-live',
        icao24: '780001',
        callsign: 'CA981',
        latitude: 40,
        longitude: 116,
        observedAt: '2026-07-11T08:00:20.000Z',
        registration: 'B-2482',
        aircraftType: 'B748',
      },
      now,
    );

    expect(result).toMatchObject({ registration: 'B-2482', aircraftType: 'B748' });
  });
});

describe('fusion', () => {
  it('uses the freshest valid position for the same ICAO24 aircraft', () => {
    const older = flight({ observedAt: '2026-07-11T08:00:00.000Z', sources: ['opensky'] });
    const newer = flight({ latitude: 41, sources: ['adsb-lol'] });
    const result = fuseFlights([older, newer], now);

    expect(result).toHaveLength(1);
    expect(result[0]?.latitude).toBe(41);
    expect(result[0]?.sources).toEqual(['adsb-lol', 'opensky']);
  });
});

describe('spatial queries', () => {
  it('supports bounding boxes that cross the antimeridian', () => {
    expect(isInsideBbox({ latitude: 30, longitude: 179 }, [170, 20, -170, 40])).toBe(true);
    expect(isInsideBbox({ latitude: 30, longitude: 0 }, [170, 20, -170, 40])).toBe(false);
  });

  it('calculates airport distance and filters nearby flights', () => {
    expect(distanceKm(40.0799, 116.6031, 40.1, 116.6)).toBeLessThan(5);
    expect(nearbyFlights([flight()], { latitude: 40.0799, longitude: 116.6031 }, 100)).toHaveLength(
      1,
    );
  });
});

describe('route matching', () => {
  it('matches only flights with reliable origin and destination', () => {
    expect(
      matchRouteFlights([flight(), flight({ id: 'no-route', origin: undefined })], 'PEK', 'JFK'),
    ).toHaveLength(1);
  });

  it('rejects a route with the same origin and destination', () => {
    expect(() => matchRouteFlights([flight()], 'PEK', 'PEK')).toThrow('different');
  });
});
