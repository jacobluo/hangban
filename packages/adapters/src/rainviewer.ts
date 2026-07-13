import { z } from 'zod';

const RAINVIEWER_TILE_HOST = 'https://tilecache.rainviewer.com';
const RAINVIEWER_API_BASE_URL = 'https://api.rainviewer.com';

const radarFrameSchema = z.object({
  time: z.number().int().positive(),
  path: z.string().regex(/^\/v2\/radar\/[A-Za-z0-9_-]+$/),
});

const tileFrameSchema = z.object({
  upstreamHost: z.literal(RAINVIEWER_TILE_HOST),
  upstreamPath: radarFrameSchema.shape.path,
});

const weatherMapsSchema = z.object({
  host: z.literal(RAINVIEWER_TILE_HOST),
  radar: z.object({
    past: z.array(z.unknown()),
  }),
});

export type WeatherRadarProviderFrame = {
  providerId: 'rainviewer';
  frameId: string;
  frameTime: string;
  upstreamHost: string;
  upstreamPath: string;
};

export type WeatherRadarTile = {
  bytes: Uint8Array;
  contentType: 'image/png';
};

export interface WeatherRadarProvider {
  fetchLatestFrame(): Promise<WeatherRadarProviderFrame>;
  fetchTile(
    frame: Pick<WeatherRadarProviderFrame, 'upstreamHost' | 'upstreamPath'>,
    z: number,
    x: number,
    y: number,
  ): Promise<WeatherRadarTile>;
}

export class WeatherRadarProviderError extends Error {
  constructor(
    public readonly code: 'TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'WeatherRadarProviderError';
  }
}

type RainViewerProviderOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  maxTileBytes: number;
};

function normalizeRequestError(error: unknown): WeatherRadarProviderError {
  if (error instanceof WeatherRadarProviderError) return error;
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new WeatherRadarProviderError('TIMEOUT', 'RainViewer request timed out');
  }
  return new WeatherRadarProviderError('UPSTREAM_ERROR', 'RainViewer request failed');
}

export function createRainViewerProvider({
  baseUrl,
  fetchImpl = fetch,
  timeoutMs,
  maxTileBytes,
}: RainViewerProviderOptions): WeatherRadarProvider {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

  const request = async (url: string): Promise<Response> => {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        throw new WeatherRadarProviderError(
          'UPSTREAM_ERROR',
          `RainViewer returned HTTP ${response.status}`,
        );
      }
      return response;
    } catch (error) {
      throw normalizeRequestError(error);
    }
  };

  return {
    async fetchLatestFrame() {
      if (normalizedBaseUrl !== RAINVIEWER_API_BASE_URL) {
        throw new WeatherRadarProviderError(
          'INVALID_RESPONSE',
          'RainViewer base URL is not allowed',
        );
      }
      let payload: unknown;
      try {
        payload = await (await request(`${normalizedBaseUrl}/weather-maps.json`)).json();
      } catch (error) {
        if (error instanceof WeatherRadarProviderError) throw error;
        if (
          error instanceof DOMException &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
          throw normalizeRequestError(error);
        }
        throw new WeatherRadarProviderError('INVALID_RESPONSE', 'RainViewer returned invalid JSON');
      }

      const parsed = weatherMapsSchema.safeParse(payload);
      if (!parsed.success) {
        throw new WeatherRadarProviderError(
          'INVALID_RESPONSE',
          'RainViewer returned invalid metadata',
        );
      }
      const frames = parsed.data.radar.past
        .map((frame) => radarFrameSchema.safeParse(frame))
        .filter((frame) => frame.success)
        .map((frame) => frame.data)
        .sort((left, right) => right.time - left.time);
      const newest = frames[0];
      if (!newest) {
        throw new WeatherRadarProviderError(
          'INVALID_RESPONSE',
          'RainViewer returned no valid radar frame',
        );
      }

      return {
        providerId: 'rainviewer',
        frameId: `frame-${newest.time}`,
        frameTime: new Date(newest.time * 1_000).toISOString(),
        upstreamHost: parsed.data.host,
        upstreamPath: newest.path,
      };
    },

    async fetchTile(frame, z, x, y) {
      const parsedFrame = tileFrameSchema.safeParse(frame);
      if (!parsedFrame.success) {
        throw new WeatherRadarProviderError('INVALID_RESPONSE', 'RainViewer tile frame is invalid');
      }
      const response = await request(
        `${parsedFrame.data.upstreamHost}${parsedFrame.data.upstreamPath}/512/${z}/${x}/${y}/2/1_1.png`,
      );
      if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'image/png') {
        throw new WeatherRadarProviderError(
          'INVALID_RESPONSE',
          'RainViewer returned a non-PNG tile',
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw normalizeRequestError(error);
      }
      if (bytes.byteLength > maxTileBytes) {
        throw new WeatherRadarProviderError(
          'INVALID_RESPONSE',
          'RainViewer returned an oversized tile',
        );
      }
      return { bytes, contentType: 'image/png' };
    },
  };
}
