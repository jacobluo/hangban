import { createHash } from 'node:crypto';

import type { Airport, AirportListResponse, Bbox } from '@hangban/contracts';
import type { Pool } from 'pg';

export type AirportSearchMatch = {
  airport: Airport;
  matchedAlias?: string;
  matchType: 'code' | 'city' | 'name';
};

export type AirportViewportQuery = {
  bbox: Bbox;
  zoom: number;
  limit: number;
  cursor?: string;
};

type AirportRow = {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string;
  localized_city: string | null;
  country: string;
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  airport_type: Airport['type'];
};

type SearchRow = AirportRow & {
  matched_alias: string | null;
  match_type: AirportSearchMatch['matchType'];
};

const airportColumns = `
  a.iata, a.icao, a.name, a.city, a.localized_city, a.country,
  ST_Y(a.location::geometry) AS latitude,
  ST_X(a.location::geometry) AS longitude,
  a.elevation_m, a.airport_type
`;

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');

const airportFromRow = (row: AirportRow): Airport => ({
  ...(row.iata ? { iata: row.iata.trim() } : {}),
  ...(row.icao ? { icao: row.icao.trim() } : {}),
  name: row.name,
  city: row.city,
  ...(row.localized_city ? { localizedCity: row.localized_city } : {}),
  country: row.country.trim(),
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  elevationM: row.elevation_m,
  type: row.airport_type,
});

const signatureFor = (bbox: Bbox, zoom: number, limit: number) =>
  createHash('sha256')
    .update(JSON.stringify([bbox, zoom, limit]))
    .digest('base64url')
    .slice(0, 16);

function cursorOffset(cursor: string | undefined, signature: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      offset?: unknown;
      signature?: unknown;
    };
    if (
      parsed.signature !== signature ||
      !Number.isInteger(parsed.offset) ||
      Number(parsed.offset) < 0
    ) {
      throw new Error();
    }
    return Number(parsed.offset);
  } catch {
    throw new Error('INVALID_CURSOR');
  }
}

export class PostgresAirportStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async findByCode(code: string): Promise<Airport | undefined> {
    const result = await this.pool.query<AirportRow>(
      `SELECT ${airportColumns} FROM airports a WHERE a.iata = $1 OR a.icao = $1 LIMIT 1`,
      [code.trim().toUpperCase()],
    );
    return result.rows[0] ? airportFromRow(result.rows[0]) : undefined;
  }

  async search(query: string, limit: number): Promise<AirportSearchMatch[]> {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return [];
    const boundedLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
    const result = await this.pool.query<SearchRow>(
      `
        SELECT ${airportColumns}, matched.alias AS matched_alias,
          CASE
            WHEN lower(coalesce(a.iata, '')) = $2 OR lower(coalesce(a.icao, '')) = $2 THEN 'code'
            WHEN regexp_replace(lower(a.city), '[[:space:][:punct:]]', '', 'g') = $1
              OR regexp_replace(lower(coalesce(a.localized_city, '')), '[[:space:][:punct:]]', '', 'g') = $1 THEN 'city'
            ELSE 'name'
          END AS match_type
        FROM airports a
        JOIN LATERAL (
          SELECT aa.alias, aa.normalized_alias
          FROM airport_aliases aa
          WHERE aa.airport_key = a.airport_key
            AND aa.normalized_alias LIKE '%' || $1 || '%'
          ORDER BY (aa.normalized_alias = $1) DESC, length(aa.normalized_alias), aa.alias
          LIMIT 1
        ) matched ON true
        ORDER BY
          (lower(coalesce(a.iata, '')) = $2 OR lower(coalesce(a.icao, '')) = $2) DESC,
          (matched.normalized_alias = $1) DESC,
          CASE a.airport_type WHEN 'large_airport' THEN 0 WHEN 'medium_airport' THEN 1 ELSE 2 END,
          coalesce(a.iata, a.icao, a.airport_key)
        LIMIT $3
      `,
      [normalizedQuery, query.trim().toLocaleLowerCase(), boundedLimit],
    );
    return result.rows.map((row) => ({
      airport: airportFromRow(row),
      ...(row.matched_alias && row.matched_alias !== row.name
        ? { matchedAlias: row.matched_alias }
        : {}),
      matchType: row.match_type,
    }));
  }

  async queryViewport({
    bbox,
    zoom,
    limit,
    cursor,
  }: AirportViewportQuery): Promise<AirportListResponse> {
    const boundedLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
    const signature = signatureFor(bbox, zoom, boundedLimit);
    const offset = cursorOffset(cursor, signature);
    const [west, south, east, north] = bbox;
    const values = [west, south, east, north, zoom, boundedLimit, offset];
    const result = await this.pool.query<AirportRow & { total_in_viewport: string }>(
      `
        SELECT ${airportColumns}, count(*) OVER () AS total_in_viewport
        FROM airports a
        WHERE ST_Intersects(
          a.location,
          ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
        )
          AND ($5 > 3 OR a.airport_type = 'large_airport')
        ORDER BY
          CASE a.airport_type WHEN 'large_airport' THEN 0 WHEN 'medium_airport' THEN 1 ELSE 2 END,
          coalesce(a.iata, a.icao, a.airport_key)
        LIMIT $6 OFFSET $7
      `,
      values,
    );
    const totalInViewport = Number(result.rows[0]?.total_in_viewport ?? 0);
    const airports = result.rows.map(airportFromRow);
    const nextOffset = offset + airports.length;
    const nextCursor =
      nextOffset < totalInViewport
        ? Buffer.from(JSON.stringify({ offset: nextOffset, signature })).toString('base64url')
        : null;
    return { airports, nextCursor, totalInViewport };
  }
}
