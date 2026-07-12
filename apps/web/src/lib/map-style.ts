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
    { id: 'sky', type: 'background', paint: { 'background-color': '#eaf2f8' } },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-opacity': 0.36,
        'raster-saturation': -0.85,
        'raster-contrast': 0.08,
      },
    },
  ],
};

export function resolveMapStyle(styleUrl?: string): string | StyleSpecification {
  return styleUrl?.trim() ? styleUrl : developmentStyle;
}
