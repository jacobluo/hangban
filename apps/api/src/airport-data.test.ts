import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { loadAirportData } from './airport-data';

describe('loadAirportData', () => {
  it('loads and validates the complete JSON document', async () => {
    const root = join(tmpdir(), `hangban-api-airports-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    const path = join(root, 'airports.json');
    await writeFile(
      path,
      JSON.stringify([
        {
          iata: 'PEK',
          name: 'Capital',
          city: 'Beijing',
          country: 'CN',
          latitude: 40,
          longitude: 116,
          elevationM: null,
          type: 'large_airport',
        },
      ]),
    );

    await expect(loadAirportData(path)).resolves.toHaveLength(1);
  });

  it('rejects invalid JSON and invalid airport documents', async () => {
    const root = join(tmpdir(), `hangban-api-airports-${crypto.randomUUID()}`);
    await mkdir(root, { recursive: true });
    const path = join(root, 'airports.json');
    await writeFile(path, '{not json');
    await expect(loadAirportData(path)).rejects.toThrow();
    await writeFile(path, JSON.stringify([{ name: 'No code' }]));
    await expect(loadAirportData(path)).rejects.toThrow();
  });
});
