import { readsbPointFromScope } from '@hangban/adapters';
import { bboxSchema, type Bbox } from '@hangban/contracts';

export const DEFAULT_MAX_SCOPES = 64;

const MAX_CELL_DEGREES = 5;
const CACHE_PRECISION = 6;
const MIN_LONGITUDE = -180;
const MIN_LATITUDE = -90;

type BboxInput = readonly [number, number, number, number];

export type CollectionScope = {
  bbox: Bbox;
  latitude: number;
  longitude: number;
  radiusNm: number;
  cacheKey: string;
};

function quantize(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(CACHE_PRECISION);
}

function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function bboxCenter(bbox: Bbox): { latitude: number; longitude: number } {
  const [west, south, east, north] = bbox;
  const eastwardSpan = west <= east ? east - west : east + 360 - west;
  return {
    latitude: (south + north) / 2,
    longitude: normalizeLongitude(west + eastwardSpan / 2),
  };
}

function splitAntimeridian(bbox: Bbox): Bbox[] {
  const [west, south, east, north] = bbox;
  return west <= east
    ? [bbox]
    : [
        [west, south, 180, north],
        [-180, south, east, north],
      ];
}

function tile(bbox: Bbox): Bbox[] {
  const [west, south, east, north] = bbox;
  const firstColumn = Math.floor((west - MIN_LONGITUDE) / MAX_CELL_DEGREES);
  const lastColumn = Math.ceil((east - MIN_LONGITUDE) / MAX_CELL_DEGREES) - 1;
  const firstRow = Math.floor((south - MIN_LATITUDE) / MAX_CELL_DEGREES);
  const lastRow = Math.ceil((north - MIN_LATITUDE) / MAX_CELL_DEGREES) - 1;
  const cells: Bbox[] = [];

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cellWest = MIN_LONGITUDE + column * MAX_CELL_DEGREES;
      const cellSouth = MIN_LATITUDE + row * MAX_CELL_DEGREES;
      const cell: Bbox = [
        cellWest,
        cellSouth,
        cellWest + MAX_CELL_DEGREES,
        cellSouth + MAX_CELL_DEGREES,
      ];
      cells.push(cell);
    }
  }

  return cells;
}

function collectionScope(bbox: Bbox): CollectionScope {
  const point = readsbPointFromScope({ bbox });
  const cacheKey = `cell:${bbox.map(quantize).join(',')}:${quantize(point.latitude)},${quantize(
    point.longitude,
  )}:${point.radiusNm}`;
  return { bbox, ...point, cacheKey };
}

export function planScopes(
  bboxes: readonly BboxInput[],
  options: { maxScopes?: number } = {},
): CollectionScope[] {
  const maxScopes = options.maxScopes ?? DEFAULT_MAX_SCOPES;
  if (!Number.isInteger(maxScopes) || maxScopes < 0) {
    throw new RangeError('maxScopes must be a non-negative integer');
  }
  if (maxScopes === 0) return [];

  const planned = new Map<string, CollectionScope>();
  for (const candidate of bboxes) {
    const parsed = bboxSchema.parse(candidate);
    const center = bboxCenter(parsed);
    const candidateScopes = new Map<string, CollectionScope>();
    for (const section of splitAntimeridian(parsed)) {
      for (const cell of tile(section)) {
        const scope = collectionScope(cell);
        if (!candidateScopes.has(scope.cacheKey)) candidateScopes.set(scope.cacheKey, scope);
      }
    }
    const sorted = [...candidateScopes.values()].sort((left, right) => {
      const leftLatitudeDelta = left.latitude - center.latitude;
      const rightLatitudeDelta = right.latitude - center.latitude;
      const leftLongitudeDelta = normalizeLongitude(left.longitude - center.longitude);
      const rightLongitudeDelta = normalizeLongitude(right.longitude - center.longitude);
      return (
        leftLatitudeDelta ** 2 +
          leftLongitudeDelta ** 2 -
          (rightLatitudeDelta ** 2 + rightLongitudeDelta ** 2) ||
        Math.abs(leftLatitudeDelta) - Math.abs(rightLatitudeDelta) ||
        leftLatitudeDelta - rightLatitudeDelta ||
        Math.abs(leftLongitudeDelta) - Math.abs(rightLongitudeDelta) ||
        leftLongitudeDelta - rightLongitudeDelta
      );
    });
    // Earlier bboxes represent more recently active views, so their cells keep insertion priority.
    for (const scope of sorted) {
      if (!planned.has(scope.cacheKey)) planned.set(scope.cacheKey, scope);
    }
    if (planned.size >= maxScopes) break;
  }
  return [...planned.values()].slice(0, maxScopes);
}
