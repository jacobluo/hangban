// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WeatherRadarStatus } from '@hangban/contracts';

import { WeatherDataStatus } from './weather-data-status';

const availableRadar: WeatherRadarStatus = {
  available: true,
  providerId: 'rainviewer',
  frameId: 'frame-1783929600',
  frameTime: '2026-07-13T06:20:00.000Z',
  freshness: 'latest',
  tileTemplate: '/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
  attribution: {
    label: 'Weather radar by RainViewer',
    url: 'https://www.rainviewer.com/',
  },
};

describe('WeatherDataStatus', () => {
  it.each([
    ['latest', '最新'],
    ['delayed', '数据延迟'],
    ['historical-cache', '非当前天气'],
  ] as const)('renders %s as %s', (freshness, label) => {
    render(
      <WeatherDataStatus status={{ ...availableRadar, freshness }} loading={false} error={null} />,
    );

    expect(screen.getByRole('region', { name: '天气数据' })).toBeVisible();
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText('2026/7/13 06:20:00 UTC')).toBeVisible();
    expect(screen.getByText(/不代表所有区域的精确观测时间/)).toBeVisible();
  });

  it.each([
    ['DISABLED', '服务未启用'],
    ['UPSTREAM_UNAVAILABLE', '暂不可用'],
    ['NO_VALID_FRAME', '暂无有效雷达帧'],
    ['FRAME_EXPIRED', '缓存已过期'],
  ] as const)('renders %s as %s', (reason, label) => {
    render(
      <WeatherDataStatus
        status={{ available: false, providerId: 'rainviewer', reason }}
        loading={false}
        error="天气雷达暂时不可用"
      />,
    );

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText('当前没有可用帧时间')).toBeVisible();
  });

  it('distinguishes loading and request failure', () => {
    const { rerender } = render(<WeatherDataStatus status={null} loading error={null} />);
    expect(screen.getByText('正在检查')).toBeVisible();

    rerender(<WeatherDataStatus status={null} loading={false} error="天气雷达暂时不可用" />);
    expect(screen.getByText('检查失败')).toBeVisible();
  });

  it('always exposes the RainViewer attribution safely', () => {
    render(
      <WeatherDataStatus
        status={{
          available: false,
          providerId: 'rainviewer',
          reason: 'UPSTREAM_UNAVAILABLE',
        }}
        loading={false}
        error="天气雷达暂时不可用"
      />,
    );

    const attribution = screen.getByRole('link', { name: 'Weather radar by RainViewer' });
    expect(attribution).toHaveAttribute('href', 'https://www.rainviewer.com/');
    expect(attribution).toHaveAttribute('target', '_blank');
    expect(attribution).toHaveAttribute('rel', 'noreferrer');
  });
});
