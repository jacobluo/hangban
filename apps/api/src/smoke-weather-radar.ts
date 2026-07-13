import { createRainViewerProvider } from '@hangban/adapters';

const provider = createRainViewerProvider({
  baseUrl: process.env.RAINVIEWER_BASE_URL ?? 'https://api.rainviewer.com',
  timeoutMs: 8_000,
  maxTileBytes: 1_048_576,
});
const frame = await provider.fetchLatestFrame();
const tile = await provider.fetchTile(frame, 2, 2, 1);

process.stdout.write(
  `${JSON.stringify({
    providerId: frame.providerId,
    frameTime: frame.frameTime,
    tileBytes: tile.bytes.byteLength,
  })}\n`,
);
