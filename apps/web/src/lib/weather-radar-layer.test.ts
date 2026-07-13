import { describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

import type { WeatherRadarAvailableStatus } from '@hangban/contracts';

import { syncWeatherRadarLayer } from './weather-radar-layer';

function radar(
  freshness: WeatherRadarAvailableStatus['freshness'] = 'latest',
  frameId = 'frame-1783929600',
): WeatherRadarAvailableStatus {
  return {
    available: true,
    providerId: 'rainviewer',
    frameId,
    frameTime: '2026-07-13T08:00:00.000Z',
    freshness,
    tileTemplate: `/api/v1/weather/radar/tiles/${frameId}/{z}/{x}/{y}.png`,
    attribution: {
      label: 'Weather radar by RainViewer',
      url: 'https://www.rainviewer.com/',
    },
  };
}

function template(frameId = 'frame-1783929600') {
  return `http://127.0.0.1:4000/api/v1/weather/radar/tiles/${frameId}/{z}/{x}/{y}.png`;
}

function fakeMap() {
  const sources = new Set<string>();
  const layers = new Set(['planned-route', 'airport-points']);
  const map = {
    addSource: vi.fn((id: string) => sources.add(id)),
    getSource: vi.fn((id: string) => (sources.has(id) ? {} : undefined)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    setPaintProperty: vi.fn(),
  };
  return map as unknown as MapLibreMap & typeof map;
}

describe('syncWeatherRadarLayer', () => {
  it('adds an internal raster below routes and lowers opacity for historical cache', () => {
    const map = fakeMap();

    syncWeatherRadarLayer(map, radar('historical-cache'), template());

    expect(map.addSource).toHaveBeenCalledWith('weather-radar', {
      type: 'raster',
      tiles: [template()],
      tileSize: 512,
      maxzoom: 7,
    });
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'weather-radar-raster',
        type: 'raster',
        paint: { 'raster-opacity': 0.35, 'raster-fade-duration': 0 },
      }),
      'planned-route',
    );
  });

  it('is idempotent, updates opacity, and rebuilds only when the frame changes', () => {
    const map = fakeMap();
    syncWeatherRadarLayer(map, radar('latest'), template());
    syncWeatherRadarLayer(map, radar('delayed'), template());

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      'weather-radar-raster',
      'raster-opacity',
      0.55,
    );

    syncWeatherRadarLayer(map, radar('latest', 'frame-1783930200'), template('frame-1783930200'));
    expect(map.removeLayer).toHaveBeenCalledWith('weather-radar-raster');
    expect(map.removeSource).toHaveBeenCalledWith('weather-radar');
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledTimes(2);
  });

  it('removes the layer before its source when disabled', () => {
    const map = fakeMap();
    syncWeatherRadarLayer(map, radar(), template());

    syncWeatherRadarLayer(map, null, null);

    expect(map.removeLayer).toHaveBeenCalledWith('weather-radar-raster');
    expect(map.removeSource).toHaveBeenCalledWith('weather-radar');
    expect(map.removeLayer.mock.invocationCallOrder[0]).toBeLessThan(
      map.removeSource.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a provider tile template instead of exposing it to MapLibre', () => {
    const map = fakeMap();

    syncWeatherRadarLayer(
      map,
      radar(),
      'https://tilecache.rainviewer.com/v2/radar/1783929600/512/{z}/{x}/{y}/2/1_1.png',
    );

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });
});
