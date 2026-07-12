import type { Flight } from '@hangban/contracts';

export type FlightFilters = {
  maxAltitudeM: number;
  freshness: Array<Flight['freshness']>;
  airline: string;
};

export const defaultFlightFilters: FlightFilters = {
  maxAltitudeM: 13_000,
  freshness: ['live', 'delayed', 'stale'],
  airline: '',
};

export function filterFlights(flights: Flight[], filters: FlightFilters): Flight[] {
  const airlineQuery = filters.airline.trim().toLocaleUpperCase();

  return flights.filter((flight) => {
    const altitudeMatches =
      flight.altitudeM === null
        ? filters.maxAltitudeM >= defaultFlightFilters.maxAltitudeM
        : flight.altitudeM <= filters.maxAltitudeM;
    const freshnessMatches = filters.freshness.includes(flight.freshness);
    const airlineMatches =
      airlineQuery.length === 0 ||
      (flight.airline ?? '').toLocaleUpperCase().includes(airlineQuery);

    return altitudeMatches && freshnessMatches && airlineMatches;
  });
}
