import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchJson } from './http-provider';

describe('fetchJson', () => {
  afterEach(() => vi.useRealTimers());

  it('preserves Retry-After delta seconds on rate limits', async () => {
    const request = fetchJson({
      fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': '12' } }),
      url: 'https://example.test',
    });

    await expect(request).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 12_000 });
  });

  it('maps unauthorized responses to AUTH_FAILED', async () => {
    const request = fetchJson({
      fetchImpl: async () => new Response('', { status: 401 }),
      url: 'https://example.test',
    });

    await expect(request).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('passes headers and retries one unauthorized request with refreshed headers', async () => {
    const seen: Array<string | null> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return seen.length === 1 ? new Response('', { status: 401 }) : Response.json({ ok: true });
    });

    await expect(
      fetchJson({
        fetchImpl,
        url: 'https://example.test',
        headers: { Authorization: 'Bearer token-a' },
        retryUnauthorized: async () => ({ Authorization: 'Bearer token-b' }),
      }),
    ).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['Bearer token-a', 'Bearer token-b']);
  });

  it('retries unauthorized responses at most once', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));

    await expect(
      fetchJson({
        fetchImpl,
        url: 'https://example.test',
        retryUnauthorized: async () => ({ Authorization: 'Bearer refreshed' }),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('parses Retry-After HTTP dates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T08:00:00.000Z'));
    const request = fetchJson({
      fetchImpl: async () =>
        new Response('', {
          status: 429,
          headers: { 'Retry-After': 'Sat, 11 Jul 2026 08:00:12 GMT' },
        }),
      url: 'https://example.test',
    });

    await expect(request).rejects.toMatchObject({ retryAfterMs: 12_000 });
  });

  it.each(['', '-1', '1.5', 'not-a-date'])(
    'ignores invalid Retry-After value %j',
    async (value) => {
      const request = fetchJson({
        fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': value } }),
        url: 'https://example.test',
      });

      await expect(request).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        retryAfterMs: undefined,
        message: 'Provider rate limit reached',
      });
    },
  );

  it('maps timeout exceptions to a sanitized TIMEOUT error', async () => {
    const request = fetchJson({
      fetchImpl: async () => {
        throw new DOMException('secret details', 'TimeoutError');
      },
      url: 'https://example.test',
    });

    await expect(request).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'Provider request timed out',
    });
  });

  it('maps network failures to a sanitized upstream error', async () => {
    const request = fetchJson({
      fetchImpl: async () => {
        throw new Error('socket secret details');
      },
      url: 'https://example.test',
    });

    await expect(request).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'Provider request failed',
    });
  });

  it('maps generic non-success responses without exposing response bodies', async () => {
    const request = fetchJson({
      fetchImpl: async () => new Response('secret body', { status: 503 }),
      url: 'https://example.test',
    });

    await expect(request).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'Provider returned HTTP 503',
    });
  });

  it('maps invalid JSON to INVALID_RESPONSE', async () => {
    const request = fetchJson({
      fetchImpl: async () => new Response('not json', { status: 200 }),
      url: 'https://example.test',
    });

    await expect(request).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Provider returned invalid JSON',
    });
  });
});
