import { parse } from 'csv-parse/sync';

import { airportSchema, type Airport } from '@hangban/contracts';

type CsvRow = Record<string, string | undefined>;

const importedTypes = new Set(['large_airport', 'medium_airport', 'small_airport']);
const code = (value: string | undefined, length: number) => {
  const normalized = value?.trim().toUpperCase();
  return normalized?.length === length && /^[A-Z0-9]+$/.test(normalized) ? normalized : undefined;
};
const coordinate = (value: string | undefined) => (value?.trim() ? Number(value) : Number.NaN);

export function parseOurAirportsCsv(csv: string): Airport[] {
  const rows = parse(csv, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];

  const airports: Airport[] = [];
  const usedIata = new Set<string>();
  const usedIcao = new Set<string>();
  for (const row of rows) {
    const type = row.type?.trim();
    if (!type || !importedTypes.has(type)) continue;

    const latitude = coordinate(row.latitude_deg);
    const longitude = coordinate(row.longitude_deg);
    const name = row.name?.trim();
    const country = row.iso_country?.trim().toUpperCase();
    const iata = code(row.iata_code, 3);
    const icao = code(row.icao_code, 4) ?? code(row.gps_code, 4);
    if (!name || !country || (!iata && !icao)) continue;

    const elevationFt = row.elevation_ft?.trim();
    const candidate = {
      ...(iata ? { iata } : {}),
      ...(icao ? { icao } : {}),
      name,
      city: row.municipality?.trim() || name,
      country,
      latitude,
      longitude,
      elevationM: elevationFt ? Math.round(Number(elevationFt) * 0.3048) : null,
      type,
    };
    const parsed = airportSchema.safeParse(candidate);
    if (!parsed.success) continue;
    if (
      (parsed.data.iata !== undefined && usedIata.has(parsed.data.iata)) ||
      (parsed.data.icao !== undefined && usedIcao.has(parsed.data.icao))
    ) {
      continue;
    }
    airports.push(parsed.data);
    if (parsed.data.iata !== undefined) usedIata.add(parsed.data.iata);
    if (parsed.data.icao !== undefined) usedIcao.add(parsed.data.icao);
  }
  return airports;
}
