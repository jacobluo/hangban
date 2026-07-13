// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WeatherRadarAvailableStatus } from '@hangban/contracts';

const { mapInstances } = vi.hoisted(() => ({ mapInstances: [] as FakeMap[] }));

class FakeMap {
  readonly sources = new Set<string>();
  readonly layers = new Set<string>();
  readonly handlers = new Map<string, Set<() => void>>();
  readonly addSource = vi.fn((id: string) => this.sources.add(id));
  readonly getSource = vi.fn((id: string) => (this.sources.has(id) ? {} : undefined));
  readonly removeSource = vi.fn((id: string) => this.sources.delete(id));
  readonly addLayer = vi.fn((layer: { id: string }) => this.layers.add(layer.id));
  readonly getLayer = vi.fn((id: string) => (this.layers.has(id) ? {} : undefined));
  readonly removeLayer = vi.fn((id: string) => this.layers.delete(id));
  readonly setPaintProperty = vi.fn();
  readonly remove = vi.fn();
  readonly setZoom = vi.fn();
  readonly on = vi.fn(
    (event: string, handlerOrLayer: string | (() => void), handler?: () => void) => {
      const callback = typeof handlerOrLayer === 'function' ? handlerOrLayer : handler;
      if (callback === undefined) return this;
      const callbacks = this.handlers.get(event) ?? new Set();
      callbacks.add(callback);
      this.handlers.set(event, callbacks);
      return this;
    },
  );
  readonly off = vi.fn((event: string, handler: () => void) => {
    this.handlers.get(event)?.delete(handler);
    return this;
  });

  constructor() {
    mapInstances.push(this);
  }

  getZoom() {
    return 1.45;
  }

  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }
}

vi.mock('maplibre-gl', () => ({ Map: FakeMap }));

import { FlightMap } from './flight-map';

const radar: WeatherRadarAvailableStatus = {
  available: true,
  providerId: 'rainviewer',
  frameId: 'frame-1783929600',
  frameTime: '2026-07-13T08:00:00.000Z',
  freshness: 'latest',
  tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
  attribution: {
    label: 'Weather radar by RainViewer',
    url: 'https://www.rainviewer.com/',
  },
};

describe('FlightMap weather radar style lifecycle', () => {
  beforeEach(() => mapInstances.splice(0));

  it('restores unchanged radar after anchored style reload and unregisters on cleanup', async () => {
    const view = render(
      <FlightMap
        airports={[]}
        flights={[]}
        selectedFlight={null}
        selectedAirport={null}
        layers={{
          baseMap: true,
          flights: true,
          airports: true,
          tracks: true,
          labels: true,
          weatherRadar: true,
        }}
        weatherRadar={radar}
        weatherRadarTileTemplate="http://127.0.0.1:4000/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png"
        routeOrigin={null}
        routeDestination={null}
        onFlightSelect={vi.fn()}
        onAirportSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(mapInstances).toHaveLength(1));
    const map = mapInstances[0]!;
    map.emit('style.load');
    expect(map.addLayer).not.toHaveBeenCalled();

    map.layers.add('planned-route');
    map.emit('style.load');

    expect(map.addLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'weather-radar-raster' }),
      'planned-route',
    );

    map.layers.delete('weather-radar-raster');
    map.sources.delete('weather-radar');
    map.emit('style.load');

    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(map.off).toHaveBeenCalledWith('style.load', expect.any(Function));
    expect(map.remove).toHaveBeenCalledOnce();
  });
});
