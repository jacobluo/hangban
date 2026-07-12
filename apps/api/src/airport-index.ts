import { createHash } from 'node:crypto';
import type { GeoCityRecord } from '@hangban/adapters';
import type { Airport, AirportListResponse, Bbox } from '@hangban/contracts';

export type AirportSearchMatch = {
  airport: Airport;
  matchedAlias?: string;
  matchType: 'code' | 'city' | 'name';
};
type ViewportQuery = { bbox: Bbox; zoom: number; limit: number; cursor?: string };
export type AirportIndex = {
  all(): Airport[];
  findByCode(code: string): Airport | undefined;
  search(query: string, limit: number): AirportSearchMatch[];
  queryViewport(query: ViewportQuery): AirportListResponse;
};

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
const rank = { large_airport: 0, medium_airport: 1, small_airport: 2 } as const;
const distanceKm = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => {
  const radians = Math.PI / 180;
  const latitudeDelta = (b.latitude - a.latitude) * radians;
  const longitudeDelta = (b.longitude - a.longitude) * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};
const digest = (value: string) =>
  createHash('sha256').update(value).digest('base64url').slice(0, 16);

export function createAirportIndex(
  input: readonly Airport[],
  cities: readonly GeoCityRecord[] = [],
): AirportIndex {
  const cityKey = (country: string, name: string) => `${country}\0${normalize(name)}`;
  const municipalityKeys = new Set(input.map((airport) => cityKey(airport.country, airport.city)));
  const primaryCities = new Map<string, GeoCityRecord[]>();
  const aliasCities = new Map<string, GeoCityRecord[]>();
  const associate = (
    index: Map<string, GeoCityRecord[]>,
    city: GeoCityRecord,
    name: string,
    eligibleKeys: ReadonlySet<string>,
  ) => {
    const key = cityKey(city.country, name);
    if (!eligibleKeys.has(key)) return;
    const candidates = index.get(key) ?? [];
    if (!candidates.some((candidate) => candidate.geonamesId === city.geonamesId)) {
      candidates.push(city);
      index.set(key, candidates);
    }
  };
  for (const city of cities) {
    associate(primaryCities, city, city.name, municipalityKeys);
    associate(primaryCities, city, city.asciiName, municipalityKeys);
  }
  const unmatchedMunicipalities = new Set(
    [...municipalityKeys].filter((key) => !primaryCities.has(key)),
  );
  if (unmatchedMunicipalities.size > 0) {
    for (const city of cities) {
      for (const alias of city.aliases) {
        associate(aliasCities, city, alias, unmatchedMunicipalities);
      }
    }
  }
  const associatedCities = new Map<Airport, GeoCityRecord>();
  const airports = input.map((airport) => {
    const key = cityKey(airport.country, airport.city);
    const candidates = primaryCities.get(key) ?? aliasCities.get(key) ?? [];
    const exact = candidates.reduce<GeoCityRecord | undefined>(
      (nearest, candidate) =>
        nearest === undefined || distanceKm(candidate, airport) < distanceKm(nearest, airport)
          ? candidate
          : nearest,
      undefined,
    );
    const indexedAirport =
      exact?.localizedName === undefined
        ? airport
        : { ...airport, localizedCity: exact.localizedName };
    if (exact !== undefined) associatedCities.set(indexedAirport, exact);
    return indexedAirport;
  });
  const aliases = new Map<Airport, string[]>();
  const textGrams = new Map<string, Set<Airport>>();
  for (const airport of airports) {
    const city = associatedCities.get(airport);
    const values = [
      airport.iata ?? '',
      airport.icao ?? '',
      airport.name,
      airport.city,
      airport.localizedCity ?? '',
      ...(city?.aliases ?? []),
    ];
    aliases.set(airport, values);
    for (const value of values) {
      const text = normalize(value);
      for (let index = 0; index < text.length - 1; index++) {
        const gram = text.slice(index, index + 2);
        const matches = textGrams.get(gram) ?? new Set<Airport>();
        matches.add(airport);
        textGrams.set(gram, matches);
      }
    }
  }
  const sorted = [...airports].sort(
    (a, b) =>
      rank[a.type] - rank[b.type] || (a.iata ?? a.icao ?? '').localeCompare(b.iata ?? b.icao ?? ''),
  );
  const cellSize = 5;
  const cells = new Map<string, Airport[]>();
  const cellKey = (longitude: number, latitude: number) =>
    `${Math.min(71, Math.max(0, Math.floor((longitude + 180) / cellSize)))}:${Math.min(35, Math.max(0, Math.floor((latitude + 90) / cellSize)))}`;
  for (const airport of sorted) {
    const key = cellKey(airport.longitude, airport.latitude);
    const cell = cells.get(key) ?? [];
    cell.push(airport);
    cells.set(key, cell);
  }
  return {
    all: () => [...sorted],
    findByCode: (code) => {
      const q = code.toUpperCase();
      return airports.find((a) => a.iata === q || a.icao === q);
    },
    search: (query, limit) => {
      const q = normalize(query);
      const searchCandidates = q.length >= 2 ? [...(textGrams.get(q.slice(0, 2)) ?? [])] : airports;
      return searchCandidates
        .flatMap((airport) => {
          const values = aliases.get(airport)!;
          const matched = values.find((value) => normalize(value).includes(q));
          if (!matched) return [];
          const code = [airport.iata, airport.icao].some(
            (value) => value && normalize(value) === q,
          );
          const city = [airport.city, airport.localizedCity].some(
            (value) => value && normalize(value) === q,
          );
          return [
            {
              airport,
              ...(matched === airport.name ? {} : { matchedAlias: matched }),
              matchType: code ? 'code' : city ? 'city' : 'name',
            } satisfies AirportSearchMatch,
          ];
        })
        .sort(
          (a, b) =>
            (a.matchType === 'code' ? 0 : a.matchType === 'city' ? 1 : 2) -
              (b.matchType === 'code' ? 0 : b.matchType === 'city' ? 1 : 2) ||
            rank[a.airport.type] - rank[b.airport.type],
        )
        .slice(0, limit);
    },
    queryViewport: ({ bbox, zoom, limit, cursor }) => {
      const signature = digest(JSON.stringify([bbox, zoom, limit]));
      let offset = 0;
      if (cursor) {
        try {
          const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
            offset: number;
            signature: string;
          };
          if (
            parsed.signature !== signature ||
            !Number.isInteger(parsed.offset) ||
            parsed.offset < 0
          )
            throw new Error();
          offset = parsed.offset;
        } catch {
          throw new Error('INVALID_CURSOR');
        }
      }
      const [west, south, east, north] = bbox;
      const candidates = new Set<Airport>();
      const minX = Math.max(0, Math.floor((west + 180) / cellSize));
      const maxX = Math.min(71, Math.floor((east + 180) / cellSize));
      const minY = Math.max(0, Math.floor((south + 90) / cellSize));
      const maxY = Math.min(35, Math.floor((north + 90) / cellSize));
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (const airport of cells.get(`${x}:${y}`) ?? []) candidates.add(airport);
        }
      }
      const eligible = [...candidates]
        .filter(
          (a) =>
            a.longitude >= west &&
            a.longitude <= east &&
            a.latitude >= south &&
            a.latitude <= north &&
            (zoom > 3 || a.type === 'large_airport'),
        )
        .sort(
          (a, b) =>
            rank[a.type] - rank[b.type] ||
            (a.iata ?? a.icao ?? '').localeCompare(b.iata ?? b.icao ?? ''),
        );
      const page = eligible.slice(offset, offset + limit);
      const next =
        offset + page.length < eligible.length
          ? Buffer.from(JSON.stringify({ offset: offset + page.length, signature })).toString(
              'base64url',
            )
          : null;
      return { airports: page, nextCursor: next, totalInViewport: eligible.length };
    },
  };
}
