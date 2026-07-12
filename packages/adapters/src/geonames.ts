import { z } from 'zod';
import yauzl from 'yauzl';

export const geoCityRecordSchema = z.object({
  geonamesId: z.number().int().positive(),
  name: z.string().min(1),
  asciiName: z.string().min(1),
  localizedName: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).max(64),
  country: z.string().length(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  population: z.number().int().nonnegative(),
});

export type GeoCityRecord = z.infer<typeof geoCityRecordSchema>;

const supportedLanguages = new Set(['zh', 'zh-CN', 'zh-Hans', 'zh-Hant', 'en']);

export function joinGeoNames(citiesText: string, alternateNamesText: string): GeoCityRecord[] {
  const cities = new Map<number, GeoCityRecord>();
  const preferredChineseNames = new Set<number>();
  for (const line of citiesText.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split('\t');
    if (fields[6] !== 'P') continue;
    const geonamesId = Number(fields[0]);
    const name = fields[1]?.trim() ?? '';
    const asciiName = fields[2]?.trim() || name;
    const country = fields[8]?.trim().toUpperCase() ?? '';
    const aliases = new Set([name, asciiName, ...(fields[3]?.split(',') ?? [])]);
    const candidate = geoCityRecordSchema.safeParse({
      geonamesId,
      name,
      asciiName,
      aliases: [...aliases]
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 64),
      country,
      latitude: Number(fields[4]),
      longitude: Number(fields[5]),
      population: Number(fields[14] || 0),
    });
    if (candidate.success) cities.set(geonamesId, candidate.data);
  }

  for (const line of alternateNamesText.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split('\t');
    const city = cities.get(Number(fields[1]));
    const language = fields[2] ?? '';
    const value = fields[3]?.trim();
    const historic = fields[7] === '1';
    if (!city || !value || historic || !supportedLanguages.has(language)) continue;
    if (!city.aliases.includes(value) && city.aliases.length < 64) city.aliases.push(value);
    if (language.startsWith('zh')) {
      const preferred = fields[4] === '1';
      if (
        preferred ||
        (city.localizedName === undefined && !preferredChineseNames.has(city.geonamesId))
      ) {
        city.localizedName = value;
      }
      if (preferred) preferredChineseNames.add(city.geonamesId);
    }
  }
  return [...cities.values()].map((city) => geoCityRecordSchema.parse(city));
}

export async function extractGeoNamesZipText(
  zip: Buffer,
  expectedFileName: string,
  maxUncompressedBytes = 2 * 1024 * 1024 * 1024,
  includeLine?: (line: string) => boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true, validateEntrySizes: true }, (openError, archive) => {
      if (openError || !archive)
        return reject(openError ?? new Error('Unable to open GeoNames ZIP'));
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        archive.close();
        reject(error);
      };
      archive.on('error', fail);
      archive.on('end', () => {
        if (!settled) fail(new Error(`GeoNames ZIP does not contain ${expectedFileName}`));
      });
      archive.on('entry', (entry) => {
        if (entry.fileName.includes('/') || entry.fileName.includes('\\')) {
          archive.readEntry();
          return;
        }
        if (entry.fileName !== expectedFileName) {
          archive.readEntry();
          return;
        }
        if (entry.uncompressedSize > maxUncompressedBytes) {
          fail(new Error('GeoNames uncompressed data exceeded byte limit'));
          return;
        }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream)
            return fail(streamError ?? new Error('Unable to read ZIP entry'));
          const lines: string[] = [];
          const chunks: Buffer[] = [];
          const decoder = new TextDecoder();
          let remainder = '';
          let bytes = 0;
          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxUncompressedBytes) {
              stream.destroy(new Error('GeoNames uncompressed data exceeded byte limit'));
            } else if (includeLine === undefined) {
              chunks.push(chunk);
            } else {
              const text = remainder + decoder.decode(chunk, { stream: true });
              const parts = text.split(/\r?\n/);
              remainder = parts.pop() ?? '';
              for (const line of parts) if (includeLine(line)) lines.push(line);
            }
          });
          stream.on('error', fail);
          stream.on('end', () => {
            if (settled) return;
            settled = true;
            archive.close();
            if (includeLine !== undefined) remainder += decoder.decode();
            if (includeLine !== undefined && remainder && includeLine(remainder))
              lines.push(remainder);
            resolve(
              includeLine === undefined ? Buffer.concat(chunks).toString('utf8') : lines.join('\n'),
            );
          });
        });
      });
      archive.readEntry();
    });
  });
}
