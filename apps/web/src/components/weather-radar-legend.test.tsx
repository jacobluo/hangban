// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WeatherRadarAvailableStatus } from '@hangban/contracts';

import { WeatherRadarLegend } from './weather-radar-legend';

const originalTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Asia/Shanghai';
});

afterAll(() => {
  process.env.TZ = originalTimeZone;
});

function radar(freshness: WeatherRadarAvailableStatus['freshness']) {
  return {
    available: true as const,
    providerId: 'rainviewer' as const,
    frameId: 'frame-1783929600',
    frameTime: '2026-07-13T08:00:00.000Z',
    freshness,
    tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
    attribution: {
      label: 'Weather radar by RainViewer' as const,
      url: 'https://www.rainviewer.com/' as const,
    },
  };
}

describe('WeatherRadarLegend', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-13T11:20:00.000Z')));
  afterEach(() => vi.useRealTimers());

  it('marks historical cache as non-current weather and exposes attribution', () => {
    render(<WeatherRadarLegend radar={radar('historical-cache')} playbackActive={false} />);

    expect(screen.getByText('非当前天气 · 3 小时前')).toBeVisible();
    expect(screen.getByLabelText('天气雷达强度，从弱到强')).toHaveTextContent('弱中强');
    expect(screen.getAllByTestId('weather-radar-scale-segment')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Weather radar by RainViewer' })).toHaveAttribute(
      'href',
      'https://www.rainviewer.com/',
    );
    expect(screen.getByRole('link', { name: 'Weather radar by RainViewer' })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getByRole('link', { name: 'Weather radar by RainViewer' })).toHaveAttribute(
      'rel',
      'noreferrer',
    );
  });

  it('shows latest and delayed frame time and raises the legend during playback', async () => {
    const { rerender } = render(
      <WeatherRadarLegend radar={radar('latest')} playbackActive={false} />,
    );
    const latestTime = screen.getByText('16:00 GMT+8');
    expect(screen.getByText('天气雷达降水图')).toBeVisible();
    expect(screen.getByLabelText('天气雷达图例')).toBeVisible();
    expect(latestTime.parentElement).toHaveTextContent('最新 · 16:00 GMT+8');

    rerender(<WeatherRadarLegend radar={radar('delayed')} playbackActive />);
    const delayedTime = screen.getByText('16:00 GMT+8');
    expect(delayedTime.parentElement).toHaveTextContent('数据延迟 · 16:00 GMT+8');
    expect(screen.getByLabelText('天气雷达图例')).toHaveClass(
      'weather-radar-legend--playback-active',
    );

    const css = readFileSync('apps/web/src/app/globals.css', 'utf8');
    const mobileStyles = css.slice(css.indexOf('@media (max-width: 700px)'));
    expect(mobileStyles).toMatch(/\.weather-radar-legend\s*\{[^}]*top:\s*84px;[^}]*}/s);
    expect(mobileStyles).toMatch(
      /\.weather-radar-legend--playback-active\s*\{[^}]*top:\s*72px;[^}]*}/s,
    );
  });
});
