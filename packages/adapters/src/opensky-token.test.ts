import { describe, expect, it, vi } from 'vitest';

import { createOpenSkyTokenManager } from './opensky-token';

const tokenResponse = (accessToken: string, expiresIn = 1_800) =>
  Response.json({ access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' });

describe('OpenSky token manager', () => {
  it('posts client credentials and caches the access token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tokenResponse('token-a'));
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    expect(await manager.getToken()).toBe('token-a');
    expect(await manager.getToken()).toBe('token-a');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/protocol/openid-connect/token');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(String(init?.body)).toBe(
      'grant_type=client_credentials&client_id=client&client_secret=secret',
    );
  });

  it('refreshes during the final 60 seconds before expiry', async () => {
    let now = new Date('2026-07-11T08:00:00.000Z');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('token-a', 120))
      .mockResolvedValueOnce(tokenResponse('token-b', 120));
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => now,
    });

    expect(await manager.getToken()).toBe('token-a');
    now = new Date('2026-07-11T08:01:00.000Z');
    expect(await manager.getToken()).toBe('token-b');
  });

  it('shares an in-flight token request between concurrent callers', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => (resolveResponse = resolve)),
    );
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    const first = manager.getToken();
    const second = manager.getToken();
    resolveResponse(tokenResponse('token-a'));

    await expect(Promise.all([first, second])).resolves.toEqual(['token-a', 'token-a']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('invalidates a cached token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('token-a'))
      .mockResolvedValueOnce(tokenResponse('token-b'));
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    expect(await manager.getToken()).toBe('token-a');
    manager.invalidate();
    expect(await manager.getToken()).toBe('token-b');
  });

  it('does not return or cache an in-flight token invalidated before it resolves', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => resolvers.push(resolve)),
    );
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    const token = manager.getToken();
    manager.invalidate();
    resolvers[0]!(tokenResponse('token-old'));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    resolvers[1]!(tokenResponse('token-new'));

    await expect(token).resolves.toBe('token-new');
    await expect(manager.getToken()).resolves.toBe('token-new');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('ignores late invalidation of an old token after a new token is cached', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('token-a'))
      .mockResolvedValueOnce(tokenResponse('token-b'));
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    expect(await manager.getToken()).toBe('token-a');
    manager.invalidate('token-a');
    expect(await manager.getToken()).toBe('token-b');
    manager.invalidate('token-a');

    expect(await manager.getToken()).toBe('token-b');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses generation leases when consecutive generations have identical token text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tokenResponse('token-a'));
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    const first = await manager.getTokenLease();
    manager.invalidate(first);
    const second = await manager.getTokenLease();
    manager.invalidate(first);
    expect(await manager.getTokenLease()).toEqual(second);
    manager.invalidate(second);
    const third = await manager.getTokenLease();

    expect(first.token).toBe('token-a');
    expect(second.token).toBe('token-a');
    expect(third.token).toBe('token-a');
    expect([first.generation, second.generation, third.generation]).toEqual([0, 1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('ignores an old lease invalidation after a normal expiry refresh', async () => {
    let now = new Date('2026-07-11T08:00:00.000Z');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('token-a', 120))
      .mockResolvedValueOnce(tokenResponse('token-b', 120));
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl,
      now: () => now,
    });

    const first = await manager.getTokenLease();
    now = new Date('2026-07-11T08:01:00.000Z');
    const second = await manager.getTokenLease();
    manager.invalidate(first);

    expect(second.generation).not.toBe(first.generation);
    await expect(manager.getTokenLease()).resolves.toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps token timeouts safely, releases in-flight state, and recovers', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      if (fetchImpl.mock.calls.length > 1) return Promise.resolve(tokenResponse('token-a'));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'highly-sensitive',
      timeoutMs: 5,
      fetchImpl,
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    await expect(manager.getToken()).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'OpenSky token request timed out',
    });
    await expect(manager.getToken()).resolves.toBe('token-a');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps token endpoint authentication failures without exposing credentials', async () => {
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'highly-sensitive',
      fetchImpl: async () => new Response('secret response', { status: 401 }),
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    await expect(manager.getToken()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(manager.getToken()).rejects.not.toThrow(/highly-sensitive|secret response/);
  });

  it.each([
    {},
    { access_token: '', expires_in: 1_800, token_type: 'Bearer' },
    { access_token: 'token-a', expires_in: 0, token_type: 'Bearer' },
    { access_token: 'token-a', expires_in: 1_800, token_type: 'Basic' },
  ])('rejects malformed successful token response %#', async (body) => {
    const manager = createOpenSkyTokenManager({
      clientId: 'client',
      clientSecret: 'secret',
      fetchImpl: async () => Response.json(body),
      now: () => new Date('2026-07-11T08:00:00.000Z'),
    });

    await expect(manager.getToken()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
