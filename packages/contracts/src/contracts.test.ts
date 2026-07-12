import { describe, expect, it } from 'vitest';

import { airportListResponseSchema, airportSchema } from './airport';
import { flightSchema } from './flight';
import { realtimeClientMessageSchema, sourceStatusSchema } from './realtime';

const validFlight = {
  id: 'icao-a1b2c3',
  icao24: 'a1b2c3',
  callsign: 'CA981',
  latitude: 40.1,
  longitude: 116.6,
  altitudeM: 10_668,
  groundSpeedKmh: 901,
  headingDeg: 68,
  verticalRateMpm: 64,
  observedAt: '2026-07-11T08:00:00.000Z',
  freshness: 'live',
  confidence: 0.92,
  sources: ['demo'],
  origin: 'PEK',
  destination: 'JFK',
};

describe('flightSchema', () => {
  it('accepts a canonical live flight', () => {
    expect(flightSchema.parse(validFlight)).toMatchObject({ callsign: 'CA981' });
  });

  it('rejects a latitude outside the WGS 84 range', () => {
    expect(() => flightSchema.parse({ ...validFlight, latitude: 91 })).toThrow();
  });

  it('records inferred route fields from field-level sources', () => {
    expect(
      flightSchema.parse({
        ...validFlight,
        inferredFields: [],
        fieldSources: [
          {
            field: 'origin',
            providerId: 'adsbdb',
            observedAt: validFlight.observedAt,
            inferred: true,
            confidence: 0.68,
          },
        ],
      }),
    ).toMatchObject({ inferredFields: ['origin'] });
  });
});

describe('airportSchema', () => {
  it('requires at least one airport code', () => {
    expect(() =>
      airportSchema.parse({
        name: 'Unknown airport',
        city: 'Unknown',
        country: 'Unknown',
        latitude: 0,
        longitude: 0,
      }),
    ).toThrow();
  });

  it('accepts a localized city in a paginated viewport response', () => {
    expect(
      airportListResponseSchema.parse({
        airports: [
          {
            iata: 'SZX',
            icao: 'ZGSZ',
            name: "Shenzhen Bao'an International Airport",
            city: 'Shenzhen',
            localizedCity: '深圳',
            country: 'CN',
            latitude: 22.6393,
            longitude: 113.8107,
            elevationM: 4,
            type: 'large_airport',
          },
        ],
        nextCursor: 'cursor-2',
        totalInViewport: 28,
      }),
    ).toMatchObject({ totalInViewport: 28 });
  });
});

describe('realtimeClientMessageSchema', () => {
  it('rejects an inverted bounding box', () => {
    expect(() =>
      realtimeClientMessageSchema.parse({
        type: 'subscription.update',
        bbox: [120, 50, 100, 20],
      }),
    ).toThrow();
  });
});

describe('sourceStatusSchema', () => {
  it('preserves stable provider attempt diagnostics', () => {
    expect(
      sourceStatusSchema.parse({
        providerId: 'opensky',
        state: 'degraded',
        lastAttemptAt: '2026-07-11T08:00:10.000Z',
        lastSuccessAt: '2026-07-11T08:00:00.000Z',
        lastRecordCount: 120,
        errorCode: 'RATE_LIMITED',
        message: '请求频率受限',
      }),
    ).toMatchObject({ errorCode: 'RATE_LIMITED', lastRecordCount: 120 });
  });

  it('rejects invalid provider attempt diagnostics', () => {
    const status = {
      providerId: 'opensky',
      state: 'degraded',
      lastSuccessAt: null,
    };

    expect(() => sourceStatusSchema.parse({ ...status, lastRecordCount: -1 })).toThrow();
    expect(() => sourceStatusSchema.parse({ ...status, lastRecordCount: 1.5 })).toThrow();
    expect(() =>
      sourceStatusSchema.parse({ ...status, lastAttemptAt: 'not-a-datetime' }),
    ).toThrow();
    expect(() => sourceStatusSchema.parse({ ...status, errorCode: 'UNKNOWN_ERROR' })).toThrow();
  });
});
