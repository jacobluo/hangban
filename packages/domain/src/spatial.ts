import type { Bbox, Flight } from '@hangban/contracts';

type Coordinate = { latitude: number; longitude: number };

export function isInsideBbox(coordinate: Coordinate, bbox: Bbox): boolean {
  const [west, south, east, north] = bbox;
  const longitudeInside =
    west <= east
      ? coordinate.longitude >= west && coordinate.longitude <= east
      : coordinate.longitude >= west || coordinate.longitude <= east;
  return longitudeInside && coordinate.latitude >= south && coordinate.latitude <= north;
}

export function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const radiusKm = 6_371;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearbyFlights(flights: Flight[], center: Coordinate, radiusKm: number): Flight[] {
  return flights.filter(
    (flight) =>
      distanceKm(center.latitude, center.longitude, flight.latitude, flight.longitude) <= radiusKm,
  );
}
