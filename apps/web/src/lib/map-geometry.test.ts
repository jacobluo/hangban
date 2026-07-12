import { describe, expect, it } from 'vitest';

import { emptyLineData, greatCircleGeometry } from './map-geometry';

describe('greatCircleGeometry', () => {
  it('splits a PEK to JFK great-circle route at the date line', () => {
    const geometry = greatCircleGeometry(
      { longitude: 116.5975, latitude: 40.0799 },
      { longitude: -73.7781, latitude: 40.6413 },
    );

    expect(geometry.type).toBe('MultiLineString');
    if (geometry.type !== 'MultiLineString') return;
    expect(geometry.coordinates.flat()).toHaveLength(67);
    for (const line of geometry.coordinates) {
      for (let index = 1; index < line.length; index += 1) {
        expect(Math.abs(line[index]![0]! - line[index - 1]![0]!)).toBeLessThanOrEqual(180);
      }
    }
  });

  it('adds curved intermediate points to routes that do not cross the date line', () => {
    const geometry = greatCircleGeometry(
      { longitude: 116.5975, latitude: 40.0799 },
      { longitude: 121.8052, latitude: 31.1443 },
      8,
    );

    expect(geometry.type).toBe('LineString');
    expect(geometry.coordinates).toHaveLength(9);
    expect(geometry.coordinates[4]?.[1]).not.toBeCloseTo((40.0799 + 31.1443) / 2, 4);
  });
});

describe('emptyLineData', () => {
  it('returns valid empty GeoJSON that clears an existing map source', () => {
    expect(emptyLineData()).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
