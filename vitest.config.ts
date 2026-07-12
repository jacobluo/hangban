import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
    ],
    coverage: { reporter: ['text', 'html'] },
    setupFiles: ['./vitest.setup.ts'],
  },
});
