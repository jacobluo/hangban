import { describe, expect, it } from 'vitest';

import { createDemoFlights } from '@hangban/testkit';

import { createRealtimeHub } from './hub';

describe('realtime hub', () => {
  it('emits only changed flights inside the client bounding box', () => {
    const [chinaFlight, atlanticFlight] = createDemoFlights(new Date('2026-07-11T08:00:00.000Z'));
    if (chinaFlight === undefined || atlanticFlight === undefined)
      throw new Error('Missing fixtures');
    const hub = createRealtimeHub();
    hub.subscribe('client-1', [100, 20, 160, 60]);
    hub.publish([chinaFlight, atlanticFlight]);

    expect(hub.drain('client-1')).toEqual([{ type: 'flight.upsert', flight: chinaFlight }]);
  });

  it('replaces the previous viewport subscription', () => {
    const [flight] = createDemoFlights(new Date('2026-07-11T08:00:00.000Z'));
    if (flight === undefined) throw new Error('Missing fixture');
    const hub = createRealtimeHub();
    hub.subscribe('client-1', [100, 20, 160, 60]);
    hub.subscribe('client-1', [-90, 30, -60, 50]);
    hub.publish([flight]);
    expect(hub.drain('client-1')).toEqual([]);
  });

  it('returns a detached snapshot of active subscription bounding boxes', () => {
    const hub = createRealtimeHub();
    hub.subscribe('a', [100, 20, 130, 50]);
    hub.subscribe('b', [101, 21, 129, 49]);

    const snapshot = hub.activeBboxes();
    expect(snapshot).toEqual([
      [100, 20, 130, 50],
      [101, 21, 129, 49],
    ]);

    snapshot[0]![0] = -180;
    hub.unsubscribe('a');
    expect(hub.activeBboxes()).toEqual([[101, 21, 129, 49]]);
  });
});
