import { flightSchema, type Airport, type Flight, type SourceStatus } from '@hangban/contracts';

import type { FlightRepository } from './repository';
import { createAirportIndex, type AirportIndex } from './airport-index';

type Seed = {
  airports: Airport[];
  flights: Flight[];
  sourceStatuses: SourceStatus[];
  airportIndex?: AirportIndex;
};

export function createMemoryRepository(seed: Seed): FlightRepository {
  let flights = [...seed.flights];
  let statuses = [...seed.sourceStatuses];
  const airportList = [...seed.airports];
  const index = seed.airportIndex ?? createAirportIndex(airportList);
  return {
    allFlights: () => [...flights],
    allAirports: () => [...airportList],
    airportIndex: () => index,
    sourceStatuses: () => [...statuses],
    replaceSnapshot: (nextFlights, nextStatuses) => {
      flights = [...nextFlights];
      statuses = [...nextStatuses];
    },
    replaceFlights: (next) => {
      flights = [...next];
    },
    replaceSourceStatuses: (next) => {
      statuses = [...next];
    },
    findFlight: (idOrCallsign) => {
      const normalized = idOrCallsign.toUpperCase();
      return flights.find(
        (flight) => flight.id === idOrCallsign || flight.callsign.toUpperCase() === normalized,
      );
    },
    mergeFlightMetadata: (id, patch, expectedIcao24) => {
      const index = flights.findIndex(
        (flight) => flight.id === id && flight.icao24 === expectedIcao24,
      );
      if (index < 0) return false;
      flights[index] = flightSchema.parse({
        ...flights[index]!,
        ...patch,
        latitude: flights[index]!.latitude,
        longitude: flights[index]!.longitude,
        altitudeM: flights[index]!.altitudeM,
        groundSpeedKmh: flights[index]!.groundSpeedKmh,
        headingDeg: flights[index]!.headingDeg,
        verticalRateMpm: flights[index]!.verticalRateMpm,
        observedAt: flights[index]!.observedAt,
      });
      return true;
    },
    findAirport: (code) => {
      return index.findByCode(code);
    },
  };
}
