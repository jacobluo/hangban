import type { RuntimeConfig } from '@hangban/config';

import { createAdsbLolProvider } from './adsb-lol';
import { createAirplanesLiveProvider } from './airplanes-live';
import { createOpenSkyProvider } from './opensky';
import { createOpenSkyTokenManager } from './opensky-token';
import type { FlightPositionProvider } from './provider';

export type LiveProviderFactoryConfig = Pick<
  RuntimeConfig,
  | 'adsbLolBaseUrl'
  | 'airplanesLiveBaseUrl'
  | 'openSkyBaseUrl'
  | 'openSkyTokenUrl'
  | 'providerTimeoutMs'
> & {
  liveProviders: readonly RuntimeConfig['liveProviders'][number][];
  openSkyClientId?: RuntimeConfig['openSkyClientId'];
  openSkyClientSecret?: RuntimeConfig['openSkyClientSecret'];
};

export function createLiveProviders(
  config: LiveProviderFactoryConfig,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): FlightPositionProvider[] {
  const seenProviderIds = new Set<string>();
  for (const providerId of config.liveProviders) {
    if (seenProviderIds.has(providerId)) {
      throw new RangeError(`Duplicate live provider: ${providerId}`);
    }
    seenProviderIds.add(providerId);
  }
  if (Boolean(config.openSkyClientId) !== Boolean(config.openSkyClientSecret)) {
    throw new Error('OpenSky client ID and client secret must be configured together');
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());

  return config.liveProviders.map((providerId) => {
    switch (providerId) {
      case 'adsb-lol':
        return createAdsbLolProvider({
          fetchImpl,
          baseUrl: config.adsbLolBaseUrl,
          timeoutMs: config.providerTimeoutMs,
        });
      case 'airplanes-live':
        return createAirplanesLiveProvider({
          fetchImpl,
          baseUrl: config.airplanesLiveBaseUrl,
          timeoutMs: config.providerTimeoutMs,
        });
      case 'opensky': {
        const tokenManager =
          config.openSkyClientId === undefined
            ? undefined
            : createOpenSkyTokenManager({
                clientId: config.openSkyClientId,
                clientSecret: config.openSkyClientSecret!,
                tokenUrl: config.openSkyTokenUrl,
                fetchImpl,
                now,
                timeoutMs: config.providerTimeoutMs,
              });
        return createOpenSkyProvider({
          fetchImpl,
          baseUrl: config.openSkyBaseUrl,
          timeoutMs: config.providerTimeoutMs,
          ...(tokenManager === undefined ? {} : { tokenManager }),
        });
      }
      default:
        throw new RangeError(`Unsupported live provider: ${String(providerId)}`);
    }
  });
}
