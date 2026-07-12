import { describe, expect, it } from 'vitest';

import { parseOurAirportsCsv } from './ourairports';

const header =
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,scheduled_service,gps_code,icao_code,iata_code';

describe('parseOurAirportsCsv', () => {
  it('maps named CSV columns into the airport contract', () => {
    const [airport] = parseOurAirportsCsv(
      [
        header,
        '1,ZBAA,large_airport,Beijing Capital International Airport,40.0799,116.6031,116,CN,Beijing,yes,ZBAA,ZBAA,PEK',
      ].join('\n'),
    );

    expect(airport).toEqual({
      iata: 'PEK',
      icao: 'ZBAA',
      name: 'Beijing Capital International Airport',
      city: 'Beijing',
      country: 'CN',
      latitude: 40.0799,
      longitude: 116.6031,
      elevationM: 35,
      type: 'large_airport',
    });
  });

  it('uses a valid GPS code, airport-name city fallback, and null elevation', () => {
    const [airport] = parseOurAirportsCsv(
      [header, '2,TEST,small_airport,Test Field,1,2,,US,,no,KABC,,'].join('\n'),
    );

    expect(airport).toMatchObject({ icao: 'KABC', city: 'Test Field', elevationM: null });
    expect(airport).not.toHaveProperty('iata');
  });

  it('filters closed, unsupported, invalid, and code-less rows without failing the import', () => {
    const rows = [
      '1,CLOSED,closed_airport,Closed,1,2,0,US,Town,no,KAAA,KAAA,AAA',
      '2,HELIPORT,heliport,Heli,1,2,0,US,Town,no,KBBB,KBBB,BBB',
      '3,BADLAT,small_airport,Bad Lat,91,2,0,US,Town,no,KCCC,KCCC,CCC',
      '4,NOCODE,small_airport,No Code,1,2,0,US,Town,no,,,,',
      '5,BADIATA,small_airport,Bad Iata,1,2,0,US,Town,no,,,XX',
      '6,FORMULA,small_airport,Formula,1,2,0,US,Town,no,,,=PE',
      '7,EMPTYLAT,small_airport,Empty Latitude,,2,0,US,Town,no,,,EMP',
    ];

    expect(parseOurAirportsCsv([header, ...rows].join('\n'))).toEqual([]);
  });

  it('prefers ICAO and normalizes codes while tolerating malformed individual rows', () => {
    const airports = parseOurAirportsCsv(
      [
        header,
        '1,X,medium_airport,Good,10,20,10,cn,City,yes,ZZZZ,zbaa,pek',
        '2,Y,medium_airport,,10,20,10,CN,City,yes,ZBAD,ZBAD,BAD',
      ].join('\n'),
    );

    expect(airports).toHaveLength(1);
    expect(airports[0]).toMatchObject({ icao: 'ZBAA', iata: 'PEK', country: 'CN' });
  });

  it('deterministically keeps the first airport when either public code conflicts', () => {
    const airports = parseOurAirportsCsv(
      [
        header,
        '1,A,small_airport,First,1,2,,US,Town,yes,,KAAA,AAA',
        '2,B,small_airport,Second,2,3,,US,Town,yes,,KBBB,BBB',
        '3,C,small_airport,Same ICAO,3,4,,US,Town,yes,,KAAA,CCC',
        '4,D,small_airport,Same IATA,4,5,,US,Town,yes,,KCCC,AAA',
        '5,E,small_airport,Cross Conflict,5,6,,US,Town,yes,,KAAA,BBB',
        '6,F,small_airport,IATA only,6,7,,US,Town,yes,,,DDD',
      ].join('\n'),
    );

    expect(airports.map(({ name }) => name)).toEqual(['First', 'Second', 'IATA only']);
  });
});
