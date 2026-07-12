import { z } from 'zod';

import { ProviderError } from './provider';

export type OpenSkyTokenLease = {
  readonly token: string;
  readonly generation: number;
};

export type OpenSkyTokenManager = {
  getToken(): Promise<string>;
  getTokenLease(): Promise<OpenSkyTokenLease>;
  invalidate(tokenOrLease?: string | OpenSkyTokenLease): void;
};

type OpenSkyTokenManagerOptions = {
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  fetchImpl: typeof fetch;
  now: () => Date;
  timeoutMs?: number;
};

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.literal('Bearer'),
});

export function createOpenSkyTokenManager({
  clientId,
  clientSecret,
  tokenUrl = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
  fetchImpl,
  now,
  timeoutMs = 8_000,
}: OpenSkyTokenManagerOptions): OpenSkyTokenManager {
  let invalidationEpoch = 0;
  let nextLeaseId = 0;
  let cached: { lease: OpenSkyTokenLease; refreshAt: number; epoch: number } | undefined;
  let inFlight: { epoch: number; promise: Promise<OpenSkyTokenLease> } | undefined;

  async function requestToken(requestEpoch: number): Promise<OpenSkyTokenLease> {
    let response: Response;
    try {
      response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError')
        throw new ProviderError('TIMEOUT', 'OpenSky token request timed out');
      throw new ProviderError('AUTH_FAILED', 'OpenSky token request failed');
    }
    if (!response.ok) throw new ProviderError('AUTH_FAILED', 'OpenSky token authentication failed');

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderError('INVALID_RESPONSE', 'OpenSky token response was invalid');
    }
    const parsed = tokenResponseSchema.safeParse(raw);
    if (!parsed.success)
      throw new ProviderError('INVALID_RESPONSE', 'OpenSky token response was invalid');

    const lease = { token: parsed.data.access_token, generation: nextLeaseId++ };
    const result = {
      lease,
      refreshAt: now().getTime() + Math.max(0, parsed.data.expires_in - 60) * 1_000,
      epoch: requestEpoch,
    };
    if (invalidationEpoch === requestEpoch) cached = result;
    return lease;
  }

  async function getTokenLease(): Promise<OpenSkyTokenLease> {
    while (true) {
      const requestEpoch = invalidationEpoch;
      if (cached?.epoch === requestEpoch && now().getTime() < cached.refreshAt) return cached.lease;
      if (inFlight?.epoch !== requestEpoch) {
        const flight = {
          epoch: requestEpoch,
          promise: requestToken(requestEpoch),
        };
        inFlight = flight;
        const release = () => {
          if (inFlight === flight) inFlight = undefined;
        };
        void flight.promise.then(release, release);
      }
      const lease = await inFlight.promise;
      if (invalidationEpoch === requestEpoch) return lease;
    }
  }

  return {
    async getToken() {
      return (await getTokenLease()).token;
    },
    getTokenLease,
    invalidate(tokenOrLease) {
      if (typeof tokenOrLease === 'string') {
        // Legacy best-effort behavior. Generation-aware callers should pass a lease.
        if (cached?.epoch !== invalidationEpoch || cached.lease.token !== tokenOrLease) return;
      } else if (tokenOrLease) {
        if (
          cached?.epoch !== invalidationEpoch ||
          cached.lease.generation !== tokenOrLease.generation
        )
          return;
      }
      invalidationEpoch += 1;
      cached = undefined;
    },
  };
}
