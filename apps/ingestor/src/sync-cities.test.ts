import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatSyncCitiesFailure, shouldIncludeGeoNameAlias, syncGeoNames } from './sync-cities';

const cityLine =
  '1795565\tShenzhen\tShenzhen\tShenzhen\t22.54554\t114.0683\tP\tPPLA\tCN\t\t30\t\t\t\t12528300';
const aliasLine = '1\t1795565\tzh\t深圳\t1\t0\t0\t0\t\t';

describe('syncGeoNames', () => {
  it('validates and atomically replaces the city file', async () => {
    const target = join(tmpdir(), `hangban-cities-${crypto.randomUUID()}.json`);
    const records = await syncGeoNames({
      target,
      citiesUrl: 'https://test/cities.zip',
      alternateNamesUrl: 'https://test/aliases.zip',
      minimumCount: 1,
      fetchImpl: async (url) => new Response(Buffer.from(String(url))),
      extractZipTextImpl: async (_buffer, expected) =>
        expected === 'cities500.txt' ? cityLine : aliasLine,
    });
    expect(records).toBe(1);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([
      expect.objectContaining({ localizedName: '深圳' }),
    ]);
  });

  it('keeps the previous file when a download fails', async () => {
    const target = join(tmpdir(), `hangban-cities-${crypto.randomUUID()}.json`);
    await writeFile(target, '[{"old":true}]');
    await expect(
      syncGeoNames({
        target,
        citiesUrl: 'https://test/cities.zip',
        alternateNamesUrl: 'https://test/aliases.zip',
        fetchImpl: async () => new Response('', { status: 503 }),
      }),
    ).rejects.toThrow('HTTP 503');
    expect(await readFile(target, 'utf8')).toBe('[{"old":true}]');
  });

  it('reads pre-downloaded file URLs without making a network request', async () => {
    const directory = join(tmpdir(), `hangban-cities-files-${crypto.randomUUID()}`);
    const citiesArchive = join(directory, 'cities.zip');
    const aliasesArchive = join(directory, 'aliases.zip');
    const target = join(directory, 'cities.json');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(directory, { recursive: true }));
    await Promise.all([writeFile(citiesArchive, 'cities'), writeFile(aliasesArchive, 'aliases')]);
    const records = await syncGeoNames({
      target,
      citiesUrl: pathToFileURL(citiesArchive).href,
      alternateNamesUrl: pathToFileURL(aliasesArchive).href,
      minimumCount: 1,
      fetchImpl: async () => {
        throw new Error('network must not be used');
      },
      extractZipTextImpl: async (_buffer, expected) =>
        expected === 'cities500.txt' ? cityLine : aliasLine,
    });
    expect(records).toBe(1);
  });

  it('reports a safe timeout reason instead of only a generic failure code', () => {
    expect(formatSyncCitiesFailure(new Error('GeoNames download timed out'))).toEqual({
      event: 'cities.sync.failed',
      code: 'CITIES_SYNC_FAILED',
      reason: 'DOWNLOAD_TIMEOUT',
    });
  });

  it('keeps current Chinese aliases and rejects historic aliases using the official columns', () => {
    expect(
      shouldIncludeGeoNameAlias('7352217\t1795565\tzh\t深圳\t\t\t\t\t\t', new Set(['1795565'])),
    ).toBe(true);
    expect(
      shouldIncludeGeoNameAlias(
        '20309089\t1795565\tzh\t宝安\t\t\t\t1\t1914\t1979',
        new Set(['1795565']),
      ),
    ).toBe(false);
  });
});
