import { describe, expect, it, vi } from 'vitest';

import { createRainViewerProvider } from './rainviewer';

function metadataResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RainViewer provider', () => {
  it('selects the newest valid past frame', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: '2.0',
            generated: 1_783_929_700,
            host: 'https://tilecache.rainviewer.com',
            radar: {
              past: [
                { time: 1_783_929_000, path: '/v2/radar/older' },
                { time: 1_783_929_600, path: '/v2/radar/newest' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 1024,
    });

    await expect(provider.fetchLatestFrame()).resolves.toEqual({
      providerId: 'rainviewer',
      frameId: 'frame-1783929600',
      frameTime: '2026-07-13T08:00:00.000Z',
      upstreamHost: 'https://tilecache.rainviewer.com',
      upstreamPath: '/v2/radar/newest',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.rainviewer.com/weather-maps.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects a non-PNG tile response', async () => {
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: vi.fn(
        async () => new Response('not png', { headers: { 'content-type': 'text/plain' } }),
      ) as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 1024,
    });
    await expect(
      provider.fetchTile(
        { upstreamHost: 'https://tilecache.rainviewer.com', upstreamPath: '/v2/radar/frame' },
        7,
        1,
        2,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    ['http host', { host: 'http://tilecache.rainviewer.com', radar: { past: [] } }],
    ['foreign host', { host: 'https://example.test', radar: { past: [] } }],
    ['empty frames', { host: 'https://tilecache.rainviewer.com', radar: { past: [] } }],
  ])('rejects invalid metadata: %s', async (_name, payload) => {
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: vi.fn(async () => metadataResponse(payload)) as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 4,
    });
    await expect(provider.fetchLatestFrame()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('ignores an invalid older frame and selects the valid frame', async () => {
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: vi.fn(async () =>
        metadataResponse({
          version: '2.0',
          generated: 1_783_929_700,
          host: 'https://tilecache.rainviewer.com',
          radar: {
            past: [
              { time: 1_783_929_000, path: 'https://example.test/invalid' },
              { time: 1_783_929_600, path: '/v2/radar/valid' },
            ],
          },
        }),
      ) as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 4,
    });
    await expect(provider.fetchLatestFrame()).resolves.toMatchObject({
      frameId: 'frame-1783929600',
      upstreamPath: '/v2/radar/valid',
    });
  });

  it('rejects a PNG larger than maxTileBytes', async () => {
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3, 4, 5]), {
            headers: { 'content-type': 'image/png' },
          }),
      ) as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 4,
    });
    await expect(
      provider.fetchTile(
        {
          upstreamHost: 'https://tilecache.rainviewer.com',
          upstreamPath: '/v2/radar/frame',
        },
        7,
        1,
        2,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    [Response.error(), 'UPSTREAM_ERROR'],
    [new DOMException('timed out', 'AbortError'), 'TIMEOUT'],
  ])('normalizes request failure', async (failure, code) => {
    const fetchImpl = vi.fn(async () => {
      if (failure instanceof Error) throw failure;
      return failure;
    });
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 4,
    });
    await expect(provider.fetchLatestFrame()).rejects.toMatchObject({ code });
  });

  it('uses the fixed tile format and returns PNG bytes', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/png' },
        }),
    );
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 4,
    });

    await expect(
      provider.fetchTile(
        {
          upstreamHost: 'https://tilecache.rainviewer.com',
          upstreamPath: '/v2/radar/frame',
        },
        7,
        1,
        2,
      ),
    ).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://tilecache.rainviewer.com/v2/radar/frame/512/7/1/2/2/1_1.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each(['http://api.rainviewer.com', 'https://example.test'])(
    'rejects an unsafe RainViewer base URL: %s',
    async (baseUrl) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const provider = createRainViewerProvider({
        baseUrl,
        fetchImpl,
        timeoutMs: 100,
        maxTileBytes: 4,
      });

      await expect(provider.fetchLatestFrame()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['https://example.test', '/v2/radar/frame'],
    ['https://tilecache.rainviewer.com', 'https://example.test/frame'],
  ])('rejects an unsafe tile frame before fetching: %s %s', async (upstreamHost, upstreamPath) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl,
      timeoutMs: 100,
      maxTileBytes: 4,
    });

    await expect(provider.fetchTile({ upstreamHost, upstreamPath }, 7, 1, 2)).rejects.toMatchObject(
      {
        code: 'INVALID_RESPONSE',
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('normalizes an aborted tile body read', async () => {
    const response = new Response(null, { headers: { 'content-type': 'image/png' } });
    vi.spyOn(response, 'arrayBuffer').mockRejectedValue(
      new DOMException('timed out', 'AbortError'),
    );
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: vi.fn(async () => response) as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 4,
    });

    await expect(
      provider.fetchTile(
        {
          upstreamHost: 'https://tilecache.rainviewer.com',
          upstreamPath: '/v2/radar/frame',
        },
        7,
        1,
        2,
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('normalizes an aborted metadata body read', async () => {
    const response = metadataResponse({});
    vi.spyOn(response, 'json').mockRejectedValue(new DOMException('timed out', 'AbortError'));
    const provider = createRainViewerProvider({
      baseUrl: 'https://api.rainviewer.com',
      fetchImpl: vi.fn(async () => response) as typeof fetch,
      timeoutMs: 100,
      maxTileBytes: 4,
    });

    await expect(provider.fetchLatestFrame()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
