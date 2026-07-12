import type { Airport, Flight, SourceStatus } from '@hangban/contracts';
import type { AirportIndex } from './airport-index';

export interface FlightRepository {
  allFlights(): Flight[];
  allAirports(): Airport[];
  airportIndex(): AirportIndex;
  sourceStatuses(): SourceStatus[];
  replaceSnapshot(flights: Flight[], statuses: SourceStatus[]): void;
  replaceFlights(flights: Flight[]): void;
  replaceSourceStatuses(statuses: SourceStatus[]): void;
  findFlight(idOrCallsign: string): Flight | undefined;
  mergeFlightMetadata(id: string, patch: Partial<Flight>, expectedIcao24: string): boolean;
  findAirport(code: string): Airport | undefined;
}
