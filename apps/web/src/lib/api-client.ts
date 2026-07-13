import {
  airportListResponseSchema,
  airportSchema,
  mapSnapshotSchema,
  weatherRadarStatusSchema,
  type Airport,
  type AirportListResponse,
  type Bbox,
  type MapSnapshot,
  type WeatherRadarStatus,
} from '@hangban/contracts';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export async function fetchMapSnapshot(bbox: Bbox, signal?: AbortSignal): Promise<MapSnapshot> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/map/snapshot?bbox=${bbox.join(',')}`,
    signal === undefined ? undefined : { signal },
  );
  if (!response.ok) throw new Error('实时航班数据暂时不可用');
  return mapSnapshotSchema.parse(await response.json());
}

export async function fetchViewportAirports(
  bbox: Bbox,
  cursor?: string,
  signal?: AbortSignal,
): Promise<AirportListResponse> {
  const parameters = new URLSearchParams({ bbox: bbox.join(','), zoom: '6', limit: '100' });
  if (cursor) parameters.set('cursor', cursor);
  const response = await fetch(
    `${apiBaseUrl}/api/v1/airports?${parameters}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw new Error('机场数据暂时不可用');
  return airportListResponseSchema.parse(await response.json());
}

export async function searchAirports(query: string, signal?: AbortSignal): Promise<Airport[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/search?q=${encodeURIComponent(query)}&types=airport&limit=20`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw new Error('机场搜索暂时不可用');
  const payload = (await response.json()) as { airports?: unknown };
  return airportSchema.array().parse(payload.airports ?? []);
}

export async function fetchWeatherRadarStatus(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherRadarStatus> {
  const response = await fetchImpl(
    `${apiBaseUrl}/api/v1/weather/radar`,
    signal === undefined ? undefined : { signal },
  );
  if (!response.ok) throw new Error('天气雷达暂时不可用');
  return weatherRadarStatusSchema.parse(await response.json());
}

export function resolveApiUrl(path: string): string {
  return new URL(path, `${apiBaseUrl}/`).toString().replaceAll('%7B', '{').replaceAll('%7D', '}');
}

export function realtimeUrl(): string {
  return apiBaseUrl.replace(/^http/, 'ws') + '/api/v1/live';
}
