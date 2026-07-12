import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { extractGeoNamesZipText, geoCityRecordSchema, joinGeoNames } from '@hangban/adapters';
import { loadConfig } from '@hangban/config';

type SyncOptions = {
  target: string;
  citiesUrl: string;
  alternateNamesUrl: string;
  fetchImpl?: typeof fetch;
  extractZipTextImpl?: typeof extractGeoNamesZipText;
  minimumCount?: number;
  timeoutMs?: number;
  maxDownloadBytes?: number;
};

const aliasLanguages = new Set(['zh', 'zh-CN', 'zh-Hans', 'zh-Hant', 'en']);

export function shouldIncludeGeoNameAlias(line: string, cityIds: ReadonlySet<string>) {
  const fields = line.split('\t');
  return cityIds.has(fields[1] ?? '') && aliasLanguages.has(fields[2] ?? '') && fields[7] !== '1';
}

async function download(url: string, fetchImpl: typeof fetch, signal: AbortSignal, max: number) {
  if (url.startsWith('file:')) {
    const bytes = await readFile(new URL(url));
    if (bytes.length > max) throw new Error('GeoNames download exceeded byte limit');
    return bytes;
  }
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`GeoNames download failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max)
    throw new Error('GeoNames download exceeded byte limit');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > max) throw new Error('GeoNames download exceeded byte limit');
  return bytes;
}

export async function syncGeoNames({
  target,
  citiesUrl,
  alternateNamesUrl,
  fetchImpl = fetch,
  extractZipTextImpl = extractGeoNamesZipText,
  minimumCount = 1_000,
  timeoutMs = 600_000,
  maxDownloadBytes = 512 * 1024 * 1024,
}: SyncOptions): Promise<number> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('GeoNames download timed out')),
    timeoutMs,
  );
  try {
    const [citiesZip, aliasesZip] = await Promise.all([
      download(citiesUrl, fetchImpl, controller.signal, maxDownloadBytes),
      download(alternateNamesUrl, fetchImpl, controller.signal, maxDownloadBytes),
    ]);
    const citiesText = await extractZipTextImpl(citiesZip, 'cities500.txt');
    const cityIds = new Set(
      citiesText
        .split(/\r?\n/)
        .map((line) => line.split('\t')[0])
        .filter((value): value is string => value !== undefined && value !== ''),
    );
    const aliasesText = await extractZipTextImpl(
      aliasesZip,
      'alternateNamesV2.txt',
      2 * 1024 * 1024 * 1024,
      (line) => shouldIncludeGeoNameAlias(line, cityIds),
    );
    const records = geoCityRecordSchema.array().parse(joinGeoNames(citiesText, aliasesText));
    if (records.length < minimumCount)
      throw new Error(`GeoNames record count below required minimum (${minimumCount})`);
    await writeFile(temporary, JSON.stringify(records), { encoding: 'utf8', flag: 'wx' });
    geoCityRecordSchema.array().parse(JSON.parse(await readFile(temporary, 'utf8')));
    await rename(temporary, target);
    return records.length;
  } finally {
    clearTimeout(timeout);
    await rm(temporary, { force: true });
  }
}

export async function runSyncCitiesCli(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = loadConfig(environment);
  const records = await syncGeoNames({
    target: config.geonamesDataPath,
    citiesUrl: config.geonamesCitiesUrl,
    alternateNamesUrl: config.geonamesAlternateNamesUrl,
    timeoutMs: config.geonamesSyncTimeoutMs,
  });
  process.stdout.write(`${JSON.stringify({ event: 'cities.sync', records })}\n`);
}

export function formatSyncCitiesFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const reason = message.includes('timed out')
    ? 'DOWNLOAD_TIMEOUT'
    : message.includes('HTTP ')
      ? 'DOWNLOAD_HTTP_ERROR'
      : message.includes('byte limit')
        ? 'DOWNLOAD_TOO_LARGE'
        : 'INVALID_OR_UNAVAILABLE_DATA';
  return { event: 'cities.sync.failed' as const, code: 'CITIES_SYNC_FAILED' as const, reason };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSyncCitiesCli().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify(formatSyncCitiesFailure(error))}\n`);
    process.exitCode = 1;
  });
}
