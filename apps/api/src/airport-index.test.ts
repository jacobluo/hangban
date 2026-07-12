import { describe, expect, it } from 'vitest';
import type { Airport } from '@hangban/contracts';
import type { GeoCityRecord } from '@hangban/adapters';
import { createAirportIndex } from './airport-index';

const szx: Airport = {
  iata: 'SZX',
  icao: 'ZGSZ',
  name: "Shenzhen Bao'an International Airport",
  city: 'Shenzhen',
  country: 'CN',
  latitude: 22.6393,
  longitude: 113.8107,
  elevationM: 4,
  type: 'large_airport',
};
const city: GeoCityRecord = {
  geonamesId: 1795565,
  name: 'Shenzhen',
  asciiName: 'Shenzhen',
  localizedName: '深圳',
  aliases: ['Shenzhen', '深圳'],
  country: 'CN',
  latitude: 22.5455,
  longitude: 114.0683,
  population: 12_528_300,
};

describe('airport index', () => {
  it('searches globally by Chinese, English and airport code', () => {
    const index = createAirportIndex([szx], [city]);
    for (const query of ['深圳', 'shenzhen', 'SZX', 'ZGSZ'])
      expect(index.search(query, 20)[0]?.airport.iata).toBe('SZX');
  });

  it('does not assign a nearby city when the city dataset is incomplete', () => {
    const zhuhai = {
      ...szx,
      iata: 'ZUH',
      icao: 'ZGSD',
      name: 'Zhuhai Jinwan Airport',
      city: 'Zhuhai',
      latitude: 22.0064,
      longitude: 113.376,
    } satisfies Airport;
    const index = createAirportIndex([szx, zhuhai], [city]);

    expect(index.findByCode('SZX')?.localizedCity).toBe('深圳');
    expect(index.findByCode('ZUH')?.localizedCity).toBeUndefined();
    expect(index.search('深圳', 20).map((match) => match.airport.iata)).toEqual(['SZX']);
  });

  it('chooses the nearest city when exact names are duplicated within a country', () => {
    const distantNamesake = {
      ...city,
      geonamesId: 9_999_999,
      localizedName: '深甽镇',
      latitude: 30,
      longitude: 110,
    } satisfies GeoCityRecord;

    expect(createAirportIndex([szx], [distantNamesake, city]).findByCode('SZX')).toMatchObject({
      localizedCity: '深圳',
    });
  });

  it('returns only viewport airports with stable pagination', () => {
    const index = createAirportIndex(
      [szx, { ...szx, iata: 'CAN', icao: 'ZGGG', longitude: 113.3, latitude: 23.4 }],
      [city],
    );
    const first = index.queryViewport({ bbox: [113, 22, 114, 24], zoom: 8, limit: 1 });
    expect(first.airports).toHaveLength(1);
    expect(first.totalInViewport).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    expect(
      index.queryViewport({
        bbox: [113, 22, 114, 24],
        zoom: 8,
        limit: 1,
        cursor: first.nextCursor!,
      }).airports,
    ).toHaveLength(1);
  });

  it('rejects a cursor from another query', () => {
    const index = createAirportIndex(
      [szx, { ...szx, iata: 'CAN', icao: 'ZGGG', longitude: 113.3, latitude: 23.4 }],
      [city],
    );
    const cursor = index.queryViewport({ bbox: [113, 22, 114, 24], zoom: 8, limit: 1 }).nextCursor;
    expect(() =>
      index.queryViewport({ bbox: [0, 0, 1, 1], zoom: 8, limit: 1, cursor: cursor! }),
    ).toThrow('INVALID_CURSOR');
  });

  it('builds the city association index without scanning every city for every airport', () => {
    const cities = Array.from({ length: 20_000 }, (_, index) => ({
      ...city,
      geonamesId: index + 1,
      name: `City ${index}`,
      asciiName: `City ${index}`,
      localizedName: `城市 ${index}`,
      aliases: [`City ${index}`],
    }));
    const airports = Array.from({ length: 1_000 }, (_, index) => ({
      ...szx,
      iata: undefined,
      icao: `X${String(index).padStart(3, '0')}`,
      city: `Missing ${index}`,
    }));
    const startedAt = performance.now();

    createAirportIndex(airports, cities);

    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
