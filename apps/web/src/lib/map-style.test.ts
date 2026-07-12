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
  });
});
