import type { Bbox } from '@hangban/contracts';
import type { ProviderFlight } from '@hangban/domain';

export type GeoScope = { bbox: Bbox };

export type ProviderSnapshot = {
  providerId: string;
  observedAt: string;
  flights: ProviderFlight[];
};

export interface FlightPositionProvider {
  readonly providerId: string;
  fetchSnapshot(scope: GeoScope): Promise<ProviderSnapshot>;
}

export type ProviderErrorCode =
  'RATE_LIMITED' | 'AUTH_FAILED' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE' | 'TIMEOUT';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
