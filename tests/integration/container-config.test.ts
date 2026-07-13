import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Service = {
  profiles?: string[];
  depends_on?: Record<string, { condition?: string }>;
  environment?: Record<string, string>;
  ports?: string[];
  user?: string;
};

describe('complete container configuration', () => {
  it('separates infrastructure, stack, and tool services safely', async () => {
    const compose = parse(await readFile('compose.yaml', 'utf8')) as {
      services: Record<string, Service>;
    };
    expect(compose.services.postgres?.profiles).toBeUndefined();
    expect(compose.services.redis?.profiles).toBeUndefined();
    for (const name of ['api', 'ingestor', 'web', 'migrate']) {
      expect(compose.services[name]?.profiles).toContain('stack');
      expect(compose.services[name]?.user).not.toBe('root');
    }
    for (const name of ['sync-airports', 'sync-cities']) {
      expect(compose.services[name]?.profiles).toContain('tools');
      expect(compose.services[name]?.ports).toBeUndefined();
      expect(compose.services[name]?.user).not.toBe('root');
    }
    expect(compose.services.api?.depends_on?.migrate?.condition).toBe(
      'service_completed_successfully',
    );
    expect(compose.services.ingestor?.depends_on?.migrate?.condition).toBe(
      'service_completed_successfully',
    );
    expect(compose.services.migrate?.environment?.WEB_ORIGIN).toBe(
      '${WEB_ORIGIN:-http://localhost:${WEB_PORT:-3000}}',
    );
    for (const name of ['ingestor', 'migrate'])
      expect(compose.services[name]?.ports).toBeUndefined();
  });
});
