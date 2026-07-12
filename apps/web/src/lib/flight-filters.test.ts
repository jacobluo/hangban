import { describe, expect, it } from 'vitest';

import { createDemoFlights } from '@hangban/testkit';

import { defaultFlightFilters, filterFlights } from './flight-filters';

const flights = createDemoFlights(new Date('2026-07-11T08:00:00.000Z'));

describe('filterFlights', () => {
  it('filters by altitude, freshness and airline using canonical fields', () => {
    const result = filterFlights(flights, {
      maxAltitudeM: 9_000,
      freshness: ['live'],
      airline: '东方',
    });

    expect(result.map((flight) => flight.callsign)).toEqual(['MU5102']);
  });

  it('returns all flights for the default filters', () => {
    expect(filterFlights(flights, defaultFlightFilters)).toHaveLength(flights.length);
  });

  it('does not mutate the input collection', () => {
    const before = structuredClone(flights);
    filterFlights(flights, { ...defaultFlightFilters, maxAltitudeM: 5_000 });
    expect(flights).toEqual(before);
  });
});
