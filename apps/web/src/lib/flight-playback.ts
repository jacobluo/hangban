import type { Flight } from '@hangban/contracts';

const EARTH_LATITUDE_KM_PER_DEGREE = 111.32;

function wrapLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

export function projectFlightsBack(flights: Flight[], requestedMinutes: number): Flight[] {
  const minutes = Math.min(15, Math.max(0, requestedMinutes));
  if (minutes === 0) return flights;

  return flights.map((flight) => {
    if (flight.groundSpeedKmh === null || flight.headingDeg === null) return flight;

    const distanceKm = (flight.groundSpeedKmh * minutes) / 60;
    const headingRadians = (flight.headingDeg * Math.PI) / 180;
    const latitudeDelta = (distanceKm * Math.cos(headingRadians)) / EARTH_LATITUDE_KM_PER_DEGREE;
    const longitudeScale = Math.max(0.01, Math.cos((flight.latitude * Math.PI) / 180));
    const longitudeDelta =
      (distanceKm * Math.sin(headingRadians)) / (EARTH_LATITUDE_KM_PER_DEGREE * longitudeScale);

    return {
      ...flight,
      latitude: Math.min(90, Math.max(-90, flight.latitude - latitudeDelta)),
      longitude: wrapLongitude(flight.longitude - longitudeDelta),
    };
  });
}
