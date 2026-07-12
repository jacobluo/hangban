import { describe, expect, it } from 'vitest';
import { createAdsbdbProvider, MetadataProviderError } from './adsbdb';

describe('ADSBdb metadata provider', () => {
  it('maps aircraft and callsign responses', async () => {
    const fetchImpl: typeof fetch = async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes('/aircraft/')
            ? {
                response: {
                  aircraft: {
                    mode_s: '780A61',
                    registration: 'B-2482',
                    icao_type: 'B748',
                    manufacturer: 'Boeing',
                  },
                },
              }
            : {
                response: {
                  flightroute: {
                    airline: { name: 'Air China' },
                    origin: { iata_code: 'PEK' },
                    destination: { iata_code: 'JFK' },
                  },
                },
              },
        ),
      );
    const provider = createAdsbdbProvider({ baseUrl: 'https://api.test/v0', fetchImpl });
    await expect(provider.fetchAircraft('780a61')).resolves.toMatchObject({
      registration: 'B-2482',
      aircraftType: 'B748',
    });
    await expect(provider.fetchCallsign('CA981')).resolves.toMatchObject({
      airline: 'Air China',
      origin: 'PEK',
      destination: 'JFK',
      inferred: true,
    });
  });

  it('normalizes not found and rejects unsafe identifiers', async () => {
    const provider = createAdsbdbProvider({
      baseUrl: 'https://api.test/v0',
      fetchImpl: async () => new Response('', { status: 404 }),
    });
    await expect(provider.fetchAircraft('780a61')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(provider.fetchCallsign('../secret')).rejects.toBeInstanceOf(MetadataProviderError);
  });
});
