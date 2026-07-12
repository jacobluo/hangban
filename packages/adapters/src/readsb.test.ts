import { describe, expect, it } from 'vitest';

import type { ProviderError } from './provider';
import { normalizeEpoch, parseReadsbSnapshot, readsbPointFromScope } from './readsb';

describe('parseReadsbSnapshot', () => {
  const observedAt = new Date('2026-07-11T08:00:00.000Z');

  it.each([observedAt.getTime() / 1_000, observedAt.getTime()])(
    'normalizes epoch %s to an ISO timestamp',
    (now) => {
      const snapshot = parseReadsbSnapshot('airplanes-live', { now, ac: [] });

      expect(snapshot.observedAt).toBe(observedAt.toISOString());
    },
  );

  it('converts readsb fields and units into provider flights', () => {
    const snapshot = parseReadsbSnapshot('airplanes-live', {
      now: observedAt.getTime(),
      ac: [
        {
          hex: '780001',
          flight: ' CA981 ',
          lat: 40,
          lon: 116,
          alt_baro: 'ground',
          gs: 500,
          track: 68,
          baro_rate: 100,
          r: 'B-2482',
          t: 'B748',
        },
        {
          hex: '780002',
          flight: 'CA982',
          lat: 41,
          lon: 117,
          alt_baro: 35_000,
        },
      ],
    });

    expect(snapshot.providerId).toBe('airplanes-live');
    expect(snapshot.flights[0]).toMatchObject({
      providerId: 'airplanes-live',
      callsign: 'CA981',
      altitudeM: 0,
      groundSpeedKmh: 926,
      verticalRateMpm: 30,
      registration: 'B-2482',
      aircraftType: 'B748',
    });
    expect(snapshot.flights[1]?.altitudeM).toBe(10_668);
  });

  it('drops invalid aircraft individually while retaining valid records', () => {
    const valid = { hex: '780001', flight: 'CA981', lat: 40, lon: 116 };
    const snapshot = parseReadsbSnapshot('adsb-lol', {
      now: observedAt.getTime() / 1_000,
      ac: [
        valid,
        { ...valid, hex: 'bad' },
        { ...valid, flight: ' ' },
        { ...valid, flight: ' A ' },
        { ...valid, lat: null },
        { ...valid, lon: undefined },
        'malformed',
        { completely: 'different' },
      ],
    });

    expect(snapshot.flights).toHaveLength(1);
    expect(snapshot.flights[0]?.icao24).toBe('780001');
  });

  it('sanitizes invalid optional numeric values without dropping the aircraft', () => {
    const snapshot = parseReadsbSnapshot('adsb-lol', {
      now: observedAt.getTime(),
      ac: [
        {
          hex: '780001',
          flight: 'CA981',
          lat: 40,
          lon: 116,
          alt_baro: -100,
          gs: -1,
          track: 360,
          baro_rate: -100,
        },
      ],
    });

    expect(snapshot.flights[0]).toMatchObject({
      altitudeM: null,
      groundSpeedKmh: null,
      headingDeg: null,
      verticalRateMpm: -30,
    });
  });

  it('maps unknown string altitudes to null', () => {
    const snapshot = parseReadsbSnapshot('adsb-lol', {
      now: observedAt.getTime(),
      ac: [{ hex: '780001', flight: 'CA981', lat: 40, lon: 116, alt_baro: 'unknown' }],
    });

    expect(snapshot.flights[0]?.altitudeM).toBeNull();
  });

  it('rejects invalid top-level responses with INVALID_RESPONSE', () => {
    expect(() => parseReadsbSnapshot('adsb-lol', { now: 'invalid', ac: [] })).toThrow(
      expect.objectContaining<Partial<ProviderError>>({ code: 'INVALID_RESPONSE' }),
    );
  });

  it.each([0, -1, Number.MAX_VALUE])('rejects unusable epoch %s', (now) => {
    expect(() => normalizeEpoch(now)).toThrow();
  });
});

describe('readsbPointFromScope', () => {
  it.each([
    {
      name: 'normal bbox',
      bbox: [115, 39, 117, 41] as const,
      center: [40, 116],
      radius: 76,
    },
    {
      name: 'tiny bbox',
      bbox: [116, 40, 116.00001, 40.00001] as const,
      center: [40.000005, 116.000005],
      radius: 1,
    },
    {
      name: 'large bbox',
      bbox: [-180, -90, 180, 90] as const,
      center: [0, 0],
      radius: 250,
    },
  ])('$name computes a rounded and clamped covering radius', ({ bbox, center, radius }) => {
    const point = readsbPointFromScope({ bbox: [...bbox] });

    expect(point.latitude).toBeCloseTo(center[0] ?? 0, 6);
    expect(point.longitude).toBeCloseTo(center[1] ?? 0, 6);
    expect(point.radiusNm).toBe(radius);
    expect(Number.isInteger(point.radiusNm)).toBe(true);
  });

  it('keeps antimeridian scopes centered on the antimeridian', () => {
    const point = readsbPointFromScope({ bbox: [179, -1, -179, 1] });

    expect(Math.abs(point.longitude)).toBe(180);
    expect(point.radiusNm).toBeGreaterThanOrEqual(1);
    expect(point.radiusNm).toBeLessThanOrEqual(250);
  });

  it('returns valid output near a pole', () => {
    const point = readsbPointFromScope({ bbox: [-20, 88, 20, 90] });

    expect(point).toMatchObject({ latitude: 89, longitude: 0 });
    expect(point.radiusNm).toBeGreaterThanOrEqual(1);
    expect(point.radiusNm).toBeLessThanOrEqual(250);
    expect(Number.isFinite(point.radiusNm)).toBe(true);
  });
});
