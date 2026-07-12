import { fetchJson } from './http-provider';
import type { FlightPositionProvider } from './provider';
import { parseReadsbSnapshot, readsbPointFromScope } from './readsb';

type Options = { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number };

export function createAdsbLolProvider(options: Options = {}): FlightPositionProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'https://api.adsb.lol/v2';
  return {
    providerId: 'adsb-lol',
    async fetchSnapshot(scope) {
      const { latitude, longitude, radiusNm } = readsbPointFromScope(scope);
      const raw = await fetchJson({
        fetchImpl,
        url: `${baseUrl}/lat/${latitude}/lon/${longitude}/dist/${radiusNm}`,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      return parseReadsbSnapshot('adsb-lol', raw);
    },
  };
}
