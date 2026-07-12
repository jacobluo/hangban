import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseOurAirportsCsv } from '@hangban/adapters';
import { loadConfig } from '@hangban/config';
import { airportSchema } from '@hangban/contracts';

type SyncOurAirportsOptions = {
  target: string;
  url: string;
  fetchImpl?: typeof fetch;
  minimumCount?: number;
  writeFileImpl?: typeof writeFile;
  renameImpl?: typeof rename;
  rmImpl?: typeof rm;
  timeoutMs?: number;
  maxDownloadBytes?: number;
  signal?: AbortSignal;
};

async function readLimitedResponse(
  response: Response,
  maxBytes: number,
  abort: () => void,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    abort();
    throw new Error('OurAirports download exceeded byte limit');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        abort();
        await reader.cancel().catch(() => undefined);
        throw new Error('OurAirports download exceeded byte limit');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function syncOurAirports({
  target,
  url,
  fetchImpl = fetch,
  minimumCount = 1_000,
  writeFileImpl = writeFile,
  renameImpl = rename,
  rmImpl = rm,
  timeoutMs = 30_000,
  maxDownloadBytes = 50 * 1024 * 1024,
  signal,
}: SyncOurAirportsOptions): Promise<number> {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const temporary = join(parent, `.${basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (signal?.aborted) onExternalAbort();
  const timeout = setTimeout(
    () => controller.abort(new Error('OurAirports download timed out')),
    timeoutMs,
  );
  let result: number | undefined;
  let primaryError: unknown;

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`OurAirports download failed with HTTP ${response.status}`);
    const csv = await readLimitedResponse(response, maxDownloadBytes, () => controller.abort());
    const airports = airportSchema.array().parse(parseOurAirportsCsv(csv));
    if (airports.length < minimumCount) {
      throw new Error(`OurAirports record count below required minimum (${minimumCount})`);
    }
    await writeFileImpl(temporary, JSON.stringify(airports), { encoding: 'utf8', flag: 'wx' });
    airportSchema.array().parse(JSON.parse(await readFile(temporary, 'utf8')));
    await renameImpl(temporary, target);
    result = airports.length;
  } catch (error) {
    primaryError = error;
  }

  clearTimeout(timeout);
  signal?.removeEventListener('abort', onExternalAbort);
  try {
    await rmImpl(temporary, { force: true });
  } catch (cleanupError) {
    if (primaryError !== undefined) {
      throw new AggregateError([primaryError, cleanupError], 'OurAirports sync and cleanup failed');
    }
    throw cleanupError;
  }
  if (primaryError !== undefined) throw primaryError;
  return result as number;
}

export async function runSyncAirportsCli(
  environment: Record<string, string | undefined> = process.env,
  dependencies: {
    syncImpl?: typeof syncOurAirports;
    writeSummary?: (summary: { event: 'airports.sync'; records: number }) => void;
    configBaseDir?: string;
  } = {},
): Promise<void> {
  const config = loadConfig(
    environment,
    dependencies.configBaseDir === undefined ? {} : { baseDir: dependencies.configBaseDir },
  );
  const records = await (dependencies.syncImpl ?? syncOurAirports)({
    target: config.airportsDataPath,
    url: config.ourAirportsCsvUrl,
  });
  (
    dependencies.writeSummary ?? ((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
  )({
    event: 'airports.sync',
    records,
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  void runSyncAirportsCli().catch(() => {
    process.stderr.write(
      `${JSON.stringify({ event: 'airports.sync.failed', code: 'AIRPORTS_SYNC_FAILED' })}\n`,
    );
    process.exitCode = 1;
  });
}
