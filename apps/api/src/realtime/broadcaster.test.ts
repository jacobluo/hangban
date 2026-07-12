import { describe, expect, it, vi } from 'vitest';

import type { Flight, RealtimeServerMessage, SourceStatus } from '@hangban/contracts';
import { createDemoFlights } from '@hangban/testkit';

import { createMemoryRepository } from '../memory-repository';
import { createRealtimeBroadcaster } from './broadcaster';

function fixture(): Flight {
  const flight = createDemoFlights(new Date('2026-07-12T08:00:00.000Z'))[0];
  if (flight === undefined) throw new Error('Missing flight fixture');
  return flight;
}

function repository(flights: Flight[] = [fixture()], sourceStatuses: SourceStatus[] = []) {
  return createMemoryRepository({ airports: [], flights, sourceStatuses });
}

function collector() {
  const messages: RealtimeServerMessage[] = [];
  return {
    messages,
    socket: { send: (raw: string) => messages.push(JSON.parse(raw) as RealtimeServerMessage) },
  };
}

describe('realtime broadcaster', () => {
  it('reads the flight table once per tick with 1,000 subscribed clients', () => {
    const repo = repository();
    const allFlights = vi.spyOn(repo, 'allFlights');
    const sourceStatuses = vi.spyOn(repo, 'sourceStatuses');
    const broadcaster = createRealtimeBroadcaster(repo);
    for (let index = 0; index < 1_000; index += 1) {
      broadcaster.subscribe(String(index), collector().socket, [100, 20, 160, 60]);
    }
    expect(allFlights).toHaveBeenCalledTimes(1);
    expect(sourceStatuses).toHaveBeenCalledTimes(1);
    allFlights.mockClear();
    sourceStatuses.mockClear();

    repo.replaceFlights([{ ...fixture(), altitudeM: fixture().altitudeM! + 100 }]);
    broadcaster.tick();

    expect(allFlights).toHaveBeenCalledTimes(1);
    expect(sourceStatuses).toHaveBeenCalledTimes(1);
    expect(broadcaster.clientCount()).toBe(1_000);
    expect(broadcaster.stats()).toEqual({
      clients: 1_000,
      globalFlightEntries: 1,
      globalSourceStatusEntries: 0,
      perClientFlightEntries: 0,
    });
  });

  it('treats an ID change as removing the old flight and adding a new flight', () => {
    const initial = fixture();
    const repo = repository([initial]);
    const { socket, messages } = collector();
    const broadcaster = createRealtimeBroadcaster(repo);
    broadcaster.subscribe('client', socket, [100, 20, 160, 60]);

    repo.replaceFlights([{ ...initial, id: 'icao-abcdef', icao24: 'abcdef' }]);
    broadcaster.tick();

    expect(messages).toEqual([
      { type: 'flight.upsert', flight: expect.objectContaining({ id: 'icao-abcdef' }) },
      { type: 'flight.remove', flightId: initial.id },
    ]);
  });

  it('serves one coherent baseline and never swallows repo changes around subscribe or re-subscribe', () => {
    const initial = fixture();
    const repo = repository([initial]);
    const client = collector();
    const broadcaster = createRealtimeBroadcaster(repo);

    const v2 = { ...initial, altitudeM: initial.altitudeM! + 2 };
    const v3 = { ...initial, altitudeM: initial.altitudeM! + 3 };
    repo.replaceFlights([v2]);
    expect(broadcaster.subscribe('client', client.socket, [100, 20, 160, 60]).flights).toEqual([
      initial,
    ]);
    repo.replaceFlights([v3]);
    broadcaster.tick();
    expect(client.messages).toEqual([{ type: 'flight.upsert', flight: v3 }]);

    client.messages.length = 0;
    const v4 = { ...initial, altitudeM: initial.altitudeM! + 4 };
    const v5 = { ...initial, altitudeM: initial.altitudeM! + 5 };
    repo.replaceFlights([v4]);
    expect(broadcaster.subscribe('client', client.socket, [100, 20, 160, 60]).flights).toEqual([
      v3,
    ]);
    repo.replaceFlights([v5]);
    broadcaster.tick();
    expect(client.messages).toEqual([{ type: 'flight.upsert', flight: v5 }]);
  });

  it('uses the same coherent baseline for source statuses', () => {
    const statusV1: SourceStatus = {
      providerId: 'adsb-lol',
      state: 'healthy',
      lastAttemptAt: '2026-07-12T08:00:00.000Z',
      lastSuccessAt: '2026-07-12T08:00:00.000Z',
      lastRecordCount: 1,
    };
    const repo = repository([], [statusV1]);
    const broadcaster = createRealtimeBroadcaster(repo);
    const client = collector();
    const statusV2 = { ...statusV1, lastRecordCount: 2 };
    const statusV3 = { ...statusV1, lastRecordCount: 3 };
    repo.replaceSourceStatuses([statusV2]);

    expect(
      broadcaster.subscribe('client', client.socket, [100, 20, 160, 60]).sourceStatuses,
    ).toEqual([statusV1]);
    repo.replaceSourceStatuses([statusV3]);
    broadcaster.tick();

    expect(client.messages).toEqual([{ type: 'source.status', status: statusV3 }]);
  });

  it.each([
    ['icao24', 'abcdef'],
    ['callsign', 'CA999'],
    ['airline', 'Example Air'],
    ['aircraftType', 'B789'],
    ['registration', 'B-9999'],
    ['latitude', 41],
    ['longitude', 117],
    ['altitudeM', 10_100],
    ['groundSpeedKmh', 902],
    ['headingDeg', 181],
    ['verticalRateMpm', 100],
    ['observedAt', '2026-07-12T08:00:01.000Z'],
    ['freshness', 'delayed'],
    ['confidence', 0.5],
    ['sources', ['adsb-lol', 'opensky']],
    ['origin', 'SFO'],
    ['destination', 'LHR'],
    ['inferredFields', ['origin']],
  ] as const)('emits an upsert when %s changes', (field, value) => {
    const initial = fixture();
    const repo = repository([initial]);
    const { socket, messages } = collector();
    const broadcaster = createRealtimeBroadcaster(repo);
    broadcaster.subscribe('client', socket, [100, 20, 160, 60]);

    repo.replaceFlights([{ ...initial, [field]: value }]);
    broadcaster.tick();

    expect(messages).toEqual([
      { type: 'flight.upsert', flight: expect.objectContaining({ [field]: value }) },
    ]);
  });

  it('emits remove and upsert as a flight moves out of and back into the viewport', () => {
    const initial = fixture();
    const repo = repository([initial]);
    const { socket, messages } = collector();
    const broadcaster = createRealtimeBroadcaster(repo);
    broadcaster.subscribe('client', socket, [100, 20, 160, 60]);

    repo.replaceFlights([{ ...initial, longitude: -70 }]);
    broadcaster.tick();
    repo.replaceFlights([{ ...initial, altitudeM: initial.altitudeM! + 1 }]);
    broadcaster.tick();
    repo.replaceFlights([]);
    broadcaster.tick();

    expect(messages.map(({ type }) => type)).toEqual([
      'flight.remove',
      'flight.upsert',
      'flight.remove',
    ]);
  });

  it('drops a client whose send throws and never sends to it again', () => {
    const repo = repository();
    const onDisconnect = vi.fn();
    const send = vi.fn(() => {
      throw new Error('closed');
    });
    const broadcaster = createRealtimeBroadcaster(repo, onDisconnect);
    broadcaster.subscribe('client', { send }, [100, 20, 160, 60]);

    repo.replaceFlights([{ ...fixture(), altitudeM: fixture().altitudeM! + 1 }]);
    broadcaster.tick();
    repo.replaceFlights([{ ...fixture(), altitudeM: fixture().altitudeM! + 2 }]);
    broadcaster.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledWith('client');
    expect(broadcaster.clientCount()).toBe(0);
  });
});
