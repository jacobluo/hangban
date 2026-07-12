import { describe, expect, it } from 'vitest';

import { resolveMapStyle } from './map-style';

describe('resolveMapStyle', () => {
  it('uses the configured production style URL when present', () => {
    expect(resolveMapStyle('https://tiles.example.com/style.json')).toBe(
      'https://tiles.example.com/style.json',
    );
  });

  it('falls back to a local-development OpenStreetMap style', () => {
    const style = resolveMapStyle();

    expect(style).toMatchObject({
      version: 8,
      glyphs: expect.stringContaining('{fontstack}'),
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        },
      },
    });

    expect(typeof style).toBe('object');
    if (typeof style === 'object') {
      expect(style.layers[0]).toMatchObject({
        paint: { 'background-color': '#e9f0f6' },
      });
      expect(style.layers[1]).toMatchObject({
        paint: { 'raster-saturation': -0.9, 'raster-opacity': 0.3 },
      });
    }
  });
});
