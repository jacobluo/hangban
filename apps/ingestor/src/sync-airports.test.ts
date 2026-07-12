import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSyncAirportsCli, syncOurAirports } from './sync-airports';

const roots: string[] = [];
const oldAirport = {
  iata: 'OLD',
  name: 'Old Airport',
  city: 'Old City',
  country: 'US',
  latitude: 1,
  longitude: 2,
  elevationM: null,
  type: 'small_airport' as const,
};

async function targetPath() {
  const root = join(tmpdir(), `hangban-airports-${crypto.randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true });
  return join(root, 'nested', 'airports.json');
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('syncOurAirports', () => {
  it.each([
    ['network rejection', () => Promise.reject(new Error('secret response body'))],
    [
      'non-2xx response',
      () => Promise.resolve(new Response('secret response body', { status: 503 })),
    ],
    ['too few valid airports', () => Promise.resolve(new Response('id,type,name'))],
  ])('retains the previous file after %s', async (_name, fetchImpl) => {
    const target = await targetPath();
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, JSON.stringify([oldAirport]));

    await expect(
      syncOurAirports({ target, url: 'https://example.invalid', fetchImpl }),
    ).rejects.toThrow();
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([oldAirport]);
    expect((await readdir(join(target, '..'))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('validates enough records and atomically replaces the target in a newly-created directory', async () => {
    const target = await targetPath();
    const header =
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,icao_code,iata_code';
    const rows = Array.from({ length: 1000 }, (_, index) =>
      [
        index,
        `ID${index}`,
        'small_airport',
        `Airport ${index}`,
        1,
        2,
        '',
        'US',
        'Town',
        'yes',
        '',
        index.toString(36).toUpperCase().padStart(4, '0'),
        '',
      ].join(','),
    );

    const count = await syncOurAirports({
      target,
      url: 'https://example.invalid',
      fetchImpl: async () => new Response([header, ...rows].join('\n')),
    });

    expect(count).toBe(1000);
    expect(JSON.parse(await readFile(target, 'utf8'))).toHaveLength(1000);
    expect((await readdir(join(target, '..'))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it.each(['write', 'rename'] as const)(
    'retains the previous file when the atomic %s stage fails',
    async (stage) => {
      const target = await targetPath();
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, JSON.stringify([oldAirport]));
      const header =
        'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,icao_code,iata_code';
      const csv = [header, '1,X,small_airport,New,1,2,,US,Town,yes,,,NEW'].join('\n');
      const fail = async () => {
        throw new Error(`${stage} failed`);
      };

      await expect(
        syncOurAirports({
          target,
          url: 'https://example.invalid',
          minimumCount: 1,
          fetchImpl: async () => new Response(csv),
          ...(stage === 'write' ? { writeFileImpl: fail } : { renameImpl: fail }),
        }),
      ).rejects.toThrow(`${stage} failed`);

      expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([oldAirport]);
      expect((await readdir(join(target, '..'))).filter((name) => name.endsWith('.tmp'))).toEqual(
        [],
      );
    },
  );

  it('does not allow duplicate codes to satisfy the minimum record count', async () => {
    const target = await targetPath();
    const header =
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,icao_code,iata_code';
    const rows = Array.from(
      { length: 1000 },
      (_, index) => `${index},X,small_airport,Airport ${index},1,2,,US,Town,yes,,KAAA,AAA`,
    );
    await expect(
      syncOurAirports({
        target,
        url: 'https://example.invalid',
        fetchImpl: async () => new Response([header, ...rows].join('\n')),
      }),
    ).rejects.toThrow('record count');
  });

  it('times out a hanging fetch and aborts its signal without touching the old file', async () => {
    const target = await targetPath();
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, JSON.stringify([oldAirport]));
    let observedSignal: AbortSignal | undefined;
    const pending = syncOurAirports({
      target,
      url: 'https://example.invalid',
      timeoutMs: 10,
      fetchImpl: async (_url, init) => {
        observedSignal = init?.signal ?? undefined;
        if (observedSignal?.aborted) throw observedSignal.reason;
        return await new Promise<Response>((_resolve, reject) =>
          observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), {
            once: true,
          }),
        );
      },
    });
    await expect(pending).rejects.toThrow();
    expect(observedSignal?.aborted).toBe(true);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([oldAirport]);
  });

  it('combines and respects an external abort signal', async () => {
    const target = await targetPath();
    const external = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const pending = syncOurAirports({
      target,
      url: 'https://example.invalid',
      signal: external.signal,
      fetchImpl: async (_url, init) => {
        observedSignal = init?.signal ?? undefined;
        if (observedSignal?.aborted) throw observedSignal.reason;
        return await new Promise<Response>((_resolve, reject) =>
          observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), {
            once: true,
          }),
        );
      },
    });
    external.abort(new Error('caller cancelled'));
    await expect(pending).rejects.toThrow('caller cancelled');
    expect(observedSignal?.aborted).toBe(true);
  });

  it.each(['declared', 'streamed'] as const)(
    'rejects %s downloads above the byte limit and cleans up',
    async (kind) => {
      const target = await targetPath();
      const response =
        kind === 'declared'
          ? new Response('123456', { headers: { 'content-length': '6' } })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('123'));
                  controller.enqueue(new TextEncoder().encode('456'));
                  controller.close();
                },
              }),
            );
      await expect(
        syncOurAirports({
          target,
          url: 'https://example.invalid',
          maxDownloadBytes: 5,
          fetchImpl: async () => response,
        }),
      ).rejects.toThrow('download exceeded');
      expect((await readdir(join(target, '..'))).filter((name) => name.endsWith('.tmp'))).toEqual(
        [],
      );
    },
  );

  it('accepts a response exactly at the byte limit before normal validation', async () => {
    const target = await targetPath();
    const csv = 'id,type,name';
    await expect(
      syncOurAirports({
        target,
        url: 'https://example.invalid',
        maxDownloadBytes: Buffer.byteLength(csv),
        fetchImpl: async () => new Response(csv),
      }),
    ).rejects.toThrow('record count');
  });

  it('handles a successful response without a body through normal validation', async () => {
    const target = await targetPath();
    await expect(
      syncOurAirports({
        target,
        url: 'https://example.invalid',
        fetchImpl: async () => new Response(null, { status: 200 }),
      }),
    ).rejects.toThrow('record count');
  });

  it.each(['fetch', 'rename'] as const)(
    'reports both %s and cleanup failures while retaining the old file',
    async (stage) => {
      const target = await targetPath();
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, JSON.stringify([oldAirport]));
      const csv = [
        'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,icao_code,iata_code',
        '1,X,small_airport,New,1,2,,US,Town,yes,,KNEW,NEW',
      ].join('\n');
      const error = await syncOurAirports({
        target,
        url: 'https://example.invalid',
        minimumCount: 1,
        fetchImpl:
          stage === 'fetch'
            ? async () => {
                throw new Error('primary fetch');
              }
            : async () => new Response(csv),
        ...(stage === 'rename'
          ? { renameImpl: async () => Promise.reject(new Error('primary rename')) }
          : {}),
        rmImpl: async () => Promise.reject(new Error('cleanup')),
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map(String).join(' ')).toContain(`primary ${stage}`);
      expect((error as AggregateError).errors.map(String).join(' ')).toContain('cleanup');
      expect(JSON.parse(await readFile(target, 'utf8'))).toEqual([oldAirport]);
    },
  );

  it('surfaces a cleanup-only failure after an otherwise successful replacement', async () => {
    const target = await targetPath();
    const csv = [
      'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,icao_code,iata_code',
      '1,X,small_airport,New,1,2,,US,Town,yes,,KNEW,NEW',
    ].join('\n');
    await expect(
      syncOurAirports({
        target,
        url: 'https://example.invalid',
        minimumCount: 1,
        fetchImpl: async () => new Response(csv),
        rmImpl: async () => Promise.reject(new Error('cleanup only')),
      }),
    ).rejects.toThrow('cleanup only');
    expect(JSON.parse(await readFile(target, 'utf8'))).toHaveLength(1);
  });
});

describe('runSyncAirportsCli', () => {
  it('uses configured paths and writes only a stable count summary', async () => {
    const syncImpl = vi.fn().mockResolvedValue(12_345);
    const writeSummary = vi.fn();

    await runSyncAirportsCli(
      {
        AIRPORTS_DATA_PATH: 'data/test-airports.json',
        OURAIRPORTS_CSV_URL: 'https://example.invalid/airports.csv',
      },
      { syncImpl, writeSummary, configBaseDir: '/srv/hangban' },
    );

    expect(syncImpl).toHaveBeenCalledWith({
      target: '/srv/hangban/data/test-airports.json',
      url: 'https://example.invalid/airports.csv',
    });
    expect(writeSummary).toHaveBeenCalledWith({
      event: 'airports.sync',
      records: 12_345,
    });
  });
});
