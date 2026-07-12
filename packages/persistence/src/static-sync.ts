import { createHash } from 'node:crypto';

import type { GeoCityRecord } from '@hangban/adapters';
import type { Airport } from '@hangban/contracts';

type QueryResult = { rows: unknown[] };
type SqlClient = {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
type Connectable = { connect(): Promise<SqlClient> };

export type StaticSyncSummary = { airports: number; cities: number };

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');

export function createAirportKey(airport: Airport): string {
  if (airport.icao) return `icao:${airport.icao}`;
  if (airport.iata) return `iata:${airport.iata}`;
  const value = [
    'ourairports',
    airport.country,
    airport.name,
    airport.latitude,
    airport.longitude,
  ].join('|');
  return `geo:${createHash('sha256').update(value).digest('hex')}`;
}

const distanceSquared = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => (a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2;

function associateCities(airports: readonly Airport[], cities: readonly GeoCityRecord[]) {
  const requested = new Set<string>();
  for (const airport of airports) {
    requested.add(`${airport.country}\0${normalize(airport.city)}`);
    requested.add(`${airport.country}\0${normalize(airport.city.replace(/\s*\([^)]*\)\s*/g, ''))}`);
  }
  const candidates = new Map<string, GeoCityRecord[]>();
  for (const city of cities) {
    for (const name of [city.name, city.asciiName, ...city.aliases]) {
      const key = `${city.country}\0${normalize(name)}`;
      if (!requested.has(key)) continue;
      const matches = candidates.get(key) ?? [];
      if (!matches.some((match) => match.geonamesId === city.geonamesId)) matches.push(city);
      candidates.set(key, matches);
    }
  }
  return new Map(
    airports.map((airport) => {
      const exactKey = `${airport.country}\0${normalize(airport.city)}`;
      const baseKey = `${airport.country}\0${normalize(airport.city.replace(/\s*\([^)]*\)\s*/g, ''))}`;
      const matches = candidates.get(exactKey) ?? candidates.get(baseKey) ?? [];
      const city = matches.reduce<GeoCityRecord | undefined>(
        (nearest, current) =>
          nearest === undefined ||
          distanceSquared(current, airport) < distanceSquared(nearest, airport)
            ? current
            : nearest,
        undefined,
      );
      return [airport, city] as const;
    }),
  );
}

async function insertJsonBatches(
  client: SqlClient,
  sql: string,
  rows: readonly unknown[],
  batchSize: number,
) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await client.query(sql, [JSON.stringify(rows.slice(offset, offset + batchSize))]);
  }
}

export async function syncStaticData(
  pool: Connectable,
  {
    airports,
    cities,
    sourceVersion,
  }: { airports: readonly Airport[]; cities: readonly GeoCityRecord[]; sourceVersion: string },
): Promise<StaticSyncSummary> {
  if (airports.length === 0 || cities.length === 0) throw new Error('STATIC_SYNC_EMPTY_DATASET');
  const associated = associateCities(airports, cities);
  const cityRows = cities.map((city) => ({
    geonames_id: city.geonamesId,
    name: city.name,
    ascii_name: city.asciiName,
    localized_name: city.localizedName ?? null,
    country: city.country,
    population: city.population,
    longitude: city.longitude,
    latitude: city.latitude,
  }));
  const cityAliases = cities.flatMap((city) =>
    city.aliases.flatMap((alias) => {
      const normalized = normalize(alias);
      return normalized
        ? [{ geonames_id: city.geonamesId, alias, normalized_alias: normalized }]
        : [];
    }),
  );
  const airportRows = airports.map((airport) => ({
    airport_key: createAirportKey(airport),
    iata: airport.iata ?? null,
    icao: airport.icao ?? null,
    name: airport.name,
    city: airport.city,
    localized_city: associated.get(airport)?.localizedName ?? null,
    country: airport.country,
    elevation_m: airport.elevationM,
    airport_type: airport.type,
    longitude: airport.longitude,
    latitude: airport.latitude,
  }));
  const airportAliases = airports.flatMap((airport) => {
    const city = associated.get(airport);
    const aliases = new Set([
      airport.name,
      airport.city,
      ...(airport.iata ? [airport.iata] : []),
      ...(airport.icao ? [airport.icao] : []),
      ...(city?.localizedName ? [city.localizedName] : []),
      ...(city?.aliases ?? []),
    ]);
    return [...aliases].flatMap((alias) => {
      const normalized = normalize(alias);
      return normalized
        ? [{ airport_key: createAirportKey(airport), alias, normalized_alias: normalized }]
        : [];
    });
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE temp_cities (LIKE cities INCLUDING DEFAULTS) ON COMMIT DROP;
      CREATE TEMP TABLE temp_city_aliases (LIKE city_aliases INCLUDING DEFAULTS) ON COMMIT DROP;
      CREATE TEMP TABLE temp_airports (LIKE airports INCLUDING DEFAULTS) ON COMMIT DROP;
      CREATE TEMP TABLE temp_airport_aliases (LIKE airport_aliases INCLUDING DEFAULTS) ON COMMIT DROP;
    `);
    await insertJsonBatches(
      client,
      `
      INSERT INTO temp_cities(geonames_id,name,ascii_name,localized_name,country,population,location)
      SELECT x.geonames_id,x.name,x.ascii_name,x.localized_name,x.country,x.population,
        ST_SetSRID(ST_MakePoint(x.longitude,x.latitude),4326)::geography
      FROM json_to_recordset($1::json) AS x(geonames_id bigint,name text,ascii_name text,localized_name text,country char(2),population bigint,longitude double precision,latitude double precision)
    `,
      cityRows,
      2_000,
    );
    await insertJsonBatches(
      client,
      `
      INSERT INTO temp_city_aliases(geonames_id,alias,normalized_alias,source)
      SELECT x.geonames_id,x.alias,x.normalized_alias,'geonames'
      FROM json_to_recordset($1::json) AS x(geonames_id bigint,alias text,normalized_alias text)
    `,
      cityAliases,
      10_000,
    );
    await insertJsonBatches(
      client,
      `
      INSERT INTO temp_airports(airport_key,iata,icao,name,city,localized_city,country,elevation_m,airport_type,location,source)
      SELECT x.airport_key,x.iata,x.icao,x.name,x.city,x.localized_city,x.country,x.elevation_m,x.airport_type,
        ST_SetSRID(ST_MakePoint(x.longitude,x.latitude),4326)::geography,'ourairports'
      FROM json_to_recordset($1::json) AS x(airport_key text,iata char(3),icao varchar(4),name text,city text,localized_city text,country char(2),elevation_m integer,airport_type text,longitude double precision,latitude double precision)
    `,
      airportRows,
      2_000,
    );
    await insertJsonBatches(
      client,
      `
      INSERT INTO temp_airport_aliases(airport_key,alias,normalized_alias,source)
      SELECT x.airport_key,x.alias,x.normalized_alias,'ourairports'
      FROM json_to_recordset($1::json) AS x(airport_key text,alias text,normalized_alias text)
    `,
      airportAliases,
      10_000,
    );

    await client.query(`
      INSERT INTO cities SELECT * FROM temp_cities
      ON CONFLICT (geonames_id) DO UPDATE SET name=EXCLUDED.name,ascii_name=EXCLUDED.ascii_name,localized_name=EXCLUDED.localized_name,country=EXCLUDED.country,population=EXCLUDED.population,location=EXCLUDED.location,imported_at=now();
      DELETE FROM city_aliases WHERE source='geonames';
      INSERT INTO city_aliases SELECT * FROM temp_city_aliases ON CONFLICT DO NOTHING;
      DELETE FROM cities WHERE geonames_id NOT IN (SELECT geonames_id FROM temp_cities);

      INSERT INTO airports SELECT * FROM temp_airports
      ON CONFLICT (airport_key) DO UPDATE SET iata=EXCLUDED.iata,icao=EXCLUDED.icao,name=EXCLUDED.name,city=EXCLUDED.city,localized_city=EXCLUDED.localized_city,country=EXCLUDED.country,elevation_m=EXCLUDED.elevation_m,airport_type=EXCLUDED.airport_type,location=EXCLUDED.location,imported_at=now();
      DELETE FROM airport_aliases WHERE source='ourairports';
      INSERT INTO airport_aliases SELECT * FROM temp_airport_aliases ON CONFLICT DO NOTHING;
      DELETE FROM airports WHERE source='ourairports' AND airport_key NOT IN (SELECT airport_key FROM temp_airports);
    `);
    await client.query(
      `
      INSERT INTO static_imports(source,source_version,record_count) VALUES
        ('geonames',$1,$2),('ourairports',$1,$3)
      ON CONFLICT (source) DO UPDATE SET source_version=EXCLUDED.source_version,record_count=EXCLUDED.record_count,imported_at=now()
    `,
      [sourceVersion, cities.length, airports.length],
    );
    await client.query('COMMIT');
    return { airports: airports.length, cities: cities.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error('STATIC_SYNC_FAILED', { cause: error });
  } finally {
    client.release();
  }
}
