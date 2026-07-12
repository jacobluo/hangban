import { createDemoFlights } from '@hangban/testkit';

import type { FlightPositionProvider } from './provider';

export function createDemoProvider(now: Date = new Date()): FlightPositionProvider {
  return {
    providerId: 'demo',
    async fetchSnapshot() {
      return {
        providerId: 'demo',
        observedAt: now.toISOString(),
        flights: createDemoFlights(now).map((flight) => ({
          providerId: 'demo',
          icao24: flight.icao24,
          callsign: flight.callsign,
          latitude: flight.latitude,
          longitude: flight.longitude,
          altitudeM: flight.altitudeM,
          groundSpeedKmh: flight.groundSpeedKmh,
          headingDeg: flight.headingDeg,
          verticalRateMpm: flight.verticalRateMpm,
          observedAt: flight.observedAt,
          ...(flight.origin === undefined ? {} : { origin: flight.origin }),
          ...(flight.destination === undefined ? {} : { destination: flight.destination }),
        })),
      };
    },
  };
}
