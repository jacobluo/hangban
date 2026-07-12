import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  transpilePackages: ['@hangban/contracts', '@hangban/testkit'],
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
};

export default nextConfig;
