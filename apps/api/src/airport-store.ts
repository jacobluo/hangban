import type { Airport, AirportListResponse, Bbox } from '@hangban/contracts';

import type { AirportSearchMatch } from './airport-index';

type Awaitable<T> = T | Promise<T>;

export interface AirportStore {
  findByCode(code: string): Awaitable<Airport | undefined>;
  search(query: string, limit: number): Awaitable<AirportSearchMatch[]>;
  queryViewport(query: {
    bbox: Bbox;
    zoom: number;
    limit: number;
    cursor?: string;
  }): Awaitable<AirportListResponse>;
}
