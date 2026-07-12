import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('web development command', () => {
  it('uses webpack to avoid the Turbopack cold-start CPU regression', async () => {
    const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dev).toContain('--webpack');
  });
});
