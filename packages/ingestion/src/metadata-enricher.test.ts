import { describe, expect, it, vi } from 'vitest';
import { createDemoFlights } from '@hangban/testkit';
import type { FlightMetadataProvider } from '@hangban/adapters';
import { createFlightMetadataEnricher } from './metadata-enricher';

describe('flight metadata enricher', () => {
  it('observes without blocking and emits a protected metadata patch', async () => {
    const provider: FlightMetadataProvider = {
      providerId: 'adsbdb',
      fetchAircraft: vi.fn(async (icao24) => ({
        providerId: 'adsbdb' as const,
        icao24,
        registration: 'B-2482',
        aircraftType: 'B748',
      })),
      fetchCallsign: vi.fn(async (callsign) => ({
        providerId: 'adsbdb' as const,
        callsign,
        airline: 'Air China',
        origin: 'PEK',
        destination: 'JFK',
        inferred: true as const,
      })),
    };
    const onFlightEnriched = vi.fn();
    const enricher = createFlightMetadataEnricher({ provider, onFlightEnriched });
    const flight = {
      ...createDemoFlights()[0]!,
      airline: undefined,
      aircraftType: undefined,
      registration: undefined,
      origin: undefined,
      destination: undefined,
    };
    expect(enricher.observe([flight])).toBeUndefined();
    await enricher.whenIdle();
    expect(onFlightEnriched).toHaveBeenCalledWith(
      flight.id,
      expect.objectContaining({
        registration: 'B-2482',
        origin: 'PEK',
        inferredFields: ['origin', 'destination'],
      }),
      flight.icao24,
    );
  });

  it('deduplicates repeated observations through cache', async () => {
    const provider: FlightMetadataProvider = {
      providerId: 'adsbdb',
      fetchAircraft: vi.fn(async (icao24) => ({ providerId: 'adsbdb' as const, icao24 })),
      fetchCallsign: vi.fn(async (callsign) => ({
        providerId: 'adsbdb' as const,
        callsign,
        inferred: true as const,
      })),
    };
    const enricher = createFlightMetadataEnricher({ provider, onFlightEnriched: vi.fn() });
    const flight = createDemoFlights()[0]!;
    enricher.observe([flight]);
    await enricher.whenIdle();
    enricher.observe([flight]);
    await enricher.whenIdle();
    expect(provider.fetchAircraft).toHaveBeenCalledTimes(1);
    expect(provider.fetchCallsign).toHaveBeenCalledTimes(1);
  });

  it('limits total provider request concurrency', async () => {
    let active = 0;
    let maximum = 0;
    const enter = async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };
    const provider: FlightMetadataProvider = {
      providerId: 'adsbdb',
      fetchAircraft: async (icao24) => {
        await enter();
        return { providerId: 'adsbdb', icao24 };
      },
      fetchCallsign: async (callsign) => {
        await enter();
        return { providerId: 'adsbdb', callsign, inferred: true };
      },
    };
    const enricher = createFlightMetadataEnricher({
      provider,
      concurrency: 2,
      onFlightEnriched: vi.fn(),
    });
    enricher.observe(createDemoFlights().slice(0, 6));
    await enricher.whenIdle();
    expect(maximum).toBeLessThanOrEqual(2);
  });
});
