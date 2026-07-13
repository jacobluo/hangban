// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SourceStatus, WeatherRadarStatus } from '@hangban/contracts';

import { DataStatusPage } from './data-status-page';

const statuses: SourceStatus[] = [
  {
    providerId: 'adsb-lol',
    state: 'healthy',
    lastSuccessAt: '2026-07-13T06:20:00.000Z',
    lastRecordCount: 123,
  },
];

const unavailableWeather: WeatherRadarStatus = {
  available: false,
  providerId: 'rainviewer',
  reason: 'UPSTREAM_UNAVAILABLE',
};

const originalTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Asia/Shanghai';
});

afterAll(() => {
  process.env.TZ = originalTimeZone;
});

describe('DataStatusPage', () => {
  it('keeps flight health healthy when optional weather is unavailable', () => {
    render(
      <DataStatusPage
        statuses={statuses}
        connectionState="online"
        flightCount={123}
        lastUpdatedAt="2026-07-13T06:20:00.000Z"
        weatherRadarStatus={unavailableWeather}
        weatherRadarLoading={false}
        weatherRadarError="天气雷达暂时不可用"
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onRetryWeather={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('全部服务正常');
    expect(screen.getByText('1 / 1')).toBeVisible();
    expect(screen.getByRole('region', { name: '天气数据' })).toHaveTextContent('暂不可用');
  });

  it('retries flight and weather data together', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onRetryWeather = vi.fn();
    render(
      <DataStatusPage
        statuses={statuses}
        connectionState="online"
        flightCount={123}
        lastUpdatedAt="2026-07-13T06:20:00.000Z"
        weatherRadarStatus={null}
        weatherRadarLoading={false}
        weatherRadarError={null}
        onBack={vi.fn()}
        onRetry={onRetry}
        onRetryWeather={onRetryWeather}
      />,
    );

    await user.click(screen.getByRole('button', { name: '重新获取数据' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetryWeather).toHaveBeenCalledTimes(1);
  });

  it('shows successful observations in the browser timezone with UTC metadata', async () => {
    render(
      <DataStatusPage
        statuses={statuses}
        connectionState="online"
        flightCount={123}
        lastUpdatedAt="2026-07-13T06:20:00.000Z"
        weatherRadarStatus={null}
        weatherRadarLoading={false}
        weatherRadarError={null}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onRetryWeather={vi.fn()}
      />,
    );

    const times = await screen.findAllByText('2026/7/13 14:20:00 GMT+8');
    expect(times).toHaveLength(2);
    expect(times[0]).toHaveAttribute('dateTime', '2026-07-13T06:20:00.000Z');
    expect(times[0]).toHaveAttribute('title', 'UTC：2026-07-13 06:20:00');
  });
});
