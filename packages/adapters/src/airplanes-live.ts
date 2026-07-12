import { fetchJson } from './http-provider';
import type { FlightPositionProvider } from './provider';
import { parseReadsbSnapshot, readsbPointFromScope } from './readsb';

export function createAirplanesLiveProvider(
  options: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
): FlightPositionProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? 'https://api.airplanes.live/v2';
  return {
    providerId: 'airplanes-live',
    async fetchSnapshot(scope) {
      const { latitude, longitude, radiusNm } = readsbPointFromScope(scope);
      const raw = await fetchJson({
        fetchImpl,
        url: `${baseUrl}/point/${latitude}/${longitude}/${radiusNm}`,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      return parseReadsbSnapshot('airplanes-live', raw);
    },
  };
}
