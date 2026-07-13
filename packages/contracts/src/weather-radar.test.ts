import { describe, expect, it } from 'vitest';

import { weatherRadarStatusSchema } from './weather-radar';

describe('weatherRadarStatusSchema', () => {
  it('accepts an internal tile template and visible attribution', () => {
    expect(
      weatherRadarStatusSchema.parse({
        available: true,
        providerId: 'rainviewer',
        frameId: 'frame-1783929600',
        frameTime: '2026-07-13T08:00:00.000Z',
        freshness: 'latest',
        tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
        attribution: { label: 'Weather radar by RainViewer', url: 'https://www.rainviewer.com/' },
      }),
    ).toMatchObject({ available: true, freshness: 'latest' });
  });

  it('rejects an upstream host in tileTemplate', () => {
    expect(() =>
      weatherRadarStatusSchema.parse({
        available: true,
        providerId: 'rainviewer',
        frameId: 'frame-1783929600',
        frameTime: '2026-07-13T08:00:00.000Z',
        freshness: 'latest',
        tileTemplate: 'https://tilecache.rainviewer.com/v2/radar/{z}/{x}/{y}.png',
        attribution: { label: 'Weather radar by RainViewer', url: 'https://www.rainviewer.com/' },
      }),
    ).toThrow();
  });
});
