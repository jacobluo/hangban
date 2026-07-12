import { describe, expect, it } from 'vitest';

import { createDemoFlights } from '@hangban/testkit';

import { projectFlightsBack } from './flight-playback';

const flight = createDemoFlights(new Date('2026-07-11T08:00:00.000Z'))[0]!;

describe('projectFlightsBack', () => {
  it('keeps the live position at zero minutes', () => {
    expect(projectFlightsBack([flight], 0)[0]).toEqual(flight);
  });

  it('projects a moving flight backwards without changing canonical identity', () => {
    const projected = projectFlightsBack([flight], 15)[0]!;

    expect(projected.id).toBe(flight.id);
    expect(projected.longitude).not.toBe(flight.longitude);
    expect(projected.latitude).not.toBe(flight.latitude);
  });

  it('clamps the time window and keeps coordinates valid', () => {
    const projected = projectFlightsBack(
      [{ ...flight, latitude: 89.99, longitude: 179.99, headingDeg: 45 }],
      120,
    )[0]!;

    expect(projected.latitude).toBeGreaterThanOrEqual(-90);
    expect(projected.latitude).toBeLessThanOrEqual(90);
    expect(projected.longitude).toBeGreaterThanOrEqual(-180);
    expect(projected.longitude).toBeLessThanOrEqual(180);
  });
});
