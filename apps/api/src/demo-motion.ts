import type { Flight } from '@hangban/contracts';

export function advanceDemoFlights(flights: Flight[], observedAt: Date): Flight[] {
  return flights.map((flight) => {
    const speedKmPerTick = (flight.groundSpeedKmh ?? 0) / 360;
    const heading = ((flight.headingDeg ?? 0) * Math.PI) / 180;
    const latitudeDelta = (Math.cos(heading) * speedKmPerTick) / 111;
    const longitudeScale = Math.max(0.2, Math.cos((flight.latitude * Math.PI) / 180));
    const longitudeDelta = (Math.sin(heading) * speedKmPerTick) / (111 * longitudeScale);
    const rawLongitude = flight.longitude + longitudeDelta;
    const longitude =
      rawLongitude > 180
        ? rawLongitude - 360
        : rawLongitude < -180
          ? rawLongitude + 360
          : rawLongitude;
    return {
      ...flight,
      latitude: Math.max(-90, Math.min(90, flight.latitude + latitudeDelta)),
      longitude,
      observedAt: observedAt.toISOString(),
      freshness: 'live',
    };
  });
}
