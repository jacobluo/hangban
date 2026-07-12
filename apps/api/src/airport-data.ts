import { readFile } from 'node:fs/promises';

import { airportSchema, type Airport } from '@hangban/contracts';
import { geoCityRecordSchema, type GeoCityRecord } from '@hangban/adapters';

export async function loadAirportData(path: string): Promise<Airport[]> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  return airportSchema.array().parse(raw);
}

export async function loadGeoNamesData(path: string): Promise<GeoCityRecord[]> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  return geoCityRecordSchema.array().parse(raw);
}
