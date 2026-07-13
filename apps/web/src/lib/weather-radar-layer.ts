import type { Map as MapLibreMap } from 'maplibre-gl';

import type { WeatherRadarAvailableStatus } from '@hangban/contracts';

const SOURCE_ID = 'weather-radar';
const LAYER_ID = 'weather-radar-raster';
const INTERNAL_TILE_PATH =
  /^\/api\/v1\/weather\/radar\/tiles\/(frame-[0-9]+)\/\{z\}\/\{x\}\/\{y\}\.png$/;

type RadarLayerState = { frameId: string; tileTemplate: string };

const radarLayerStates = new WeakMap<MapLibreMap, RadarLayerState>();

function removeWeatherRadar(map: MapLibreMap) {
  if (map.getLayer(LAYER_ID) !== undefined) map.removeLayer(LAYER_ID);
  if (map.getSource(SOURCE_ID) !== undefined) map.removeSource(SOURCE_ID);
  radarLayerStates.delete(map);
}

function isInternalTileTemplate(tileTemplate: string, frameId: string) {
  try {
    const url = new URL(tileTemplate);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.search === '' &&
      url.hash === '' &&
      INTERNAL_TILE_PATH.exec(decodeURIComponent(url.pathname))?.[1] === frameId
    );
  } catch {
    return false;
  }
}

export function syncWeatherRadarLayer(
  map: MapLibreMap,
  radar: WeatherRadarAvailableStatus | null,
  tileTemplate: string | null,
): void {
  if (
    radar === null ||
    tileTemplate === null ||
    !isInternalTileTemplate(tileTemplate, radar.frameId)
  ) {
    removeWeatherRadar(map);
    return;
  }

  const current = radarLayerStates.get(map);
  if (
    current !== undefined &&
    (current.frameId !== radar.frameId || current.tileTemplate !== tileTemplate)
  ) {
    removeWeatherRadar(map);
  }

  if (map.getSource(SOURCE_ID) === undefined) {
    map.addSource(SOURCE_ID, {
      type: 'raster',
      tiles: [tileTemplate],
      tileSize: 512,
      maxzoom: 7,
    });
  }

  const opacity = radar.freshness === 'historical-cache' ? 0.35 : 0.55;
  if (map.getLayer(LAYER_ID) === undefined) {
    const beforeId =
      map.getLayer('planned-route') !== undefined
        ? 'planned-route'
        : map.getLayer('airport-points') !== undefined
          ? 'airport-points'
          : undefined;
    map.addLayer(
      {
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 },
      },
      beforeId,
    );
  } else {
    map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
  }

  radarLayerStates.set(map, { frameId: radar.frameId, tileTemplate });
}
