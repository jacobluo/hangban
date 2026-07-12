import type { StyleSpecification } from 'maplibre-gl';

const developmentStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'sky', type: 'background', paint: { 'background-color': '#e9f0f6' } },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-opacity': 0.3,
        'raster-saturation': -0.9,
        'raster-contrast': 0.06,
        'raster-brightness-min': 0.08,
        'raster-brightness-max': 0.94,
      },
    },
  ],
};

export function resolveMapStyle(styleUrl?: string): string | StyleSpecification {
  return styleUrl?.trim() ? styleUrl : developmentStyle;
}
