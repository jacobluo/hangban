import type { Flight } from '@hangban/contracts';

export function matchRouteFlights(
  flights: Flight[],
  origin: string,
  destination: string,
): Flight[] {
  if (origin === destination) throw new Error('Origin and destination must be different');
  return flights.filter((flight) => flight.origin === origin && flight.destination === destination);
}
