type GeographicPoint = { longitude: number; latitude: number };
type Coordinate = [number, number];

type GreatCircleGeometry =
  | { type: 'LineString'; coordinates: Coordinate[] }
  | { type: 'MultiLineString'; coordinates: Coordinate[][] };

const toRadians = (value: number) => (value * Math.PI) / 180;
const toDegrees = (value: number) => (value * 180) / Math.PI;

export function emptyLineData() {
  return { type: 'FeatureCollection' as const, features: [] };
}

function normalizeLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function interpolateGreatCircle(
  start: GeographicPoint,
  end: GeographicPoint,
  progress: number,
): Coordinate {
  const startLatitude = toRadians(start.latitude);
  const startLongitude = toRadians(start.longitude);
  const endLatitude = toRadians(end.latitude);
  const endLongitude = toRadians(end.longitude);
  const angularDistance = Math.acos(
    Math.min(
      1,
      Math.max(
        -1,
        Math.sin(startLatitude) * Math.sin(endLatitude) +
          Math.cos(startLatitude) * Math.cos(endLatitude) * Math.cos(endLongitude - startLongitude),
      ),
    ),
  );

  if (angularDistance < 1e-8) return [start.longitude, start.latitude];
  const denominator = Math.sin(angularDistance);
  const startWeight = Math.sin((1 - progress) * angularDistance) / denominator;
  const endWeight = Math.sin(progress * angularDistance) / denominator;
  const x =
    startWeight * Math.cos(startLatitude) * Math.cos(startLongitude) +
    endWeight * Math.cos(endLatitude) * Math.cos(endLongitude);
  const y =
    startWeight * Math.cos(startLatitude) * Math.sin(startLongitude) +
    endWeight * Math.cos(endLatitude) * Math.sin(endLongitude);
  const z = startWeight * Math.sin(startLatitude) + endWeight * Math.sin(endLatitude);

  return [
    normalizeLongitude(toDegrees(Math.atan2(y, x))),
    toDegrees(Math.atan2(z, Math.hypot(x, y))),
  ];
}

export function greatCircleGeometry(
  start: GeographicPoint,
  end: GeographicPoint,
  segmentCount = 64,
): GreatCircleGeometry {
  const points = Array.from({ length: segmentCount + 1 }, (_, index) =>
    interpolateGreatCircle(start, end, index / segmentCount),
  );
  const lines: Coordinate[][] = [[points[0]!]];

  for (const point of points.slice(1)) {
    const currentLine = lines.at(-1)!;
    const previous = currentLine.at(-1)!;
    const longitudeJump = point[0] - previous[0];
    if (Math.abs(longitudeJump) <= 180) {
      currentLine.push(point);
      continue;
    }

    const adjustedLongitude = longitudeJump < -180 ? point[0] + 360 : point[0] - 360;
    const boundary = longitudeJump < -180 ? 180 : -180;
    const progress = (boundary - previous[0]) / (adjustedLongitude - previous[0]);
    const crossingLatitude = previous[1] + (point[1] - previous[1]) * progress;
    currentLine.push([boundary, crossingLatitude]);
    lines.push([[-boundary, crossingLatitude], point]);
  }

  return lines.length === 1
    ? { type: 'LineString', coordinates: lines[0]! }
    : { type: 'MultiLineString', coordinates: lines };
}
