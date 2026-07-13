// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mapFlyTo, weatherRadarState, useWeatherRadarMock, flightMapProps } = vi.hoisted(() => ({
  mapFlyTo: vi.fn(),
  weatherRadarState: {
    status: null as null | { available: boolean },
    radar: null,
    tileTemplate: null,
    loading: false,
    error: null as string | null,
    retry: vi.fn(),
  },
  useWeatherRadarMock: vi.fn(),
  flightMapProps: { current: null as Record<string, unknown> | null },
}));

vi.mock('../lib/use-weather-radar', () => ({
  useWeatherRadar: useWeatherRadarMock,
}));

vi.mock('./flight-map', async () => {
  const React = await import('react');
  return {
    FlightMap: React.forwardRef(function MockFlightMap(props, ref) {
      flightMapProps.current = props as Record<string, unknown>;
      React.useImperativeHandle(ref, () => ({
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        flyTo: mapFlyTo,
        fitRoute: vi.fn(),
      }));
      return <div aria-label="实时航班地图" />;
    }),
  };
});

import { AppShell } from './app-shell';
import { demoData } from '../lib/demo-data';

describe('AppShell', () => {
  beforeEach(() => {
    weatherRadarState.status = null;
    weatherRadarState.radar = null;
    weatherRadarState.tileTemplate = null;
    weatherRadarState.loading = false;
    weatherRadarState.error = null;
    useWeatherRadarMock.mockImplementation(() => weatherRadarState);
  });

  it('keeps weather radar disabled by default and passes no radar to the map', () => {
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    expect(useWeatherRadarMock).toHaveBeenCalledWith(false);
    expect(flightMapProps.current).toMatchObject({
      weatherRadar: null,
      weatherRadarTileTemplate: null,
    });
  });

  it('turns weather radar intent off after a non-fatal weather failure', async () => {
    weatherRadarState.error = '天气雷达暂时不可用';

    render(<AppShell initialData={demoData} mapEnabled={false} />);

    expect(await screen.findByText('天气雷达暂时不可用，航班数据不受影响。')).toBeVisible();
    expect(useWeatherRadarMock).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText('实时航班地图')).toBeVisible();
  });

  it('exposes the live map and freshness status as primary application landmarks', () => {
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    expect(screen.getByRole('main', { name: '全球实时航班地图' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '实时位置，部分覆盖' })).toBeInTheDocument();
  });

  it('opens airport exploration and selects PEK', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('tab', { name: '机场' }));
    await user.click(screen.getByRole('button', { name: /北京首都国际机场/ }));

    expect(screen.getByRole('heading', { name: 'PEK' })).toBeVisible();
    expect(screen.getByText('周边实时航班')).toBeVisible();
    expect(screen.getByText(/当前视野/)).toBeVisible();
    expect(screen.getByText('周边航班不等同于到港或离港班次')).toBeVisible();
  });

  it('searches and opens a flight', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.type(screen.getByRole('searchbox'), 'CA981');
    await user.click(screen.getByRole('button', { name: /CA981.*中国国际航空/ }));

    expect(screen.getByRole('heading', { name: 'CA981' })).toBeVisible();
    expect(screen.getByText('10,668 m')).toBeVisible();
  });

  it('groups global search results by object type and names the map tools precisely', async () => {
    const user = userEvent.setup();
    const groupedData = {
      ...demoData,
      flights: demoData.flights.map((flight, index) =>
        index === 0 ? { ...flight, airline: '北京航空' } : flight,
      ),
    };
    render(<AppShell initialData={groupedData} mapEnabled={false} />);

    await user.type(screen.getByRole('searchbox'), '北京');

    const searchResults = within(screen.getByLabelText('搜索结果'));
    expect(searchResults.getByText('航班')).toBeInTheDocument();
    expect(searchResults.getByText('机场')).toBeInTheDocument();
    expect(searchResults.getByText('城市')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开图层与筛选' })).toHaveAccessibleName();
  });

  it('keeps the current map zoom when selecting a flight', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.type(screen.getByRole('searchbox'), 'CA981');
    await user.click(screen.getByRole('button', { name: /CA981.*中国国际航空/ }));

    expect(mapFlyTo).toHaveBeenLastCalledWith(
      demoData.flights[0]!.longitude,
      demoData.flights[0]!.latitude,
    );
  });

  it('shows active flights for the selected route', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('tab', { name: '航线' }));

    expect(screen.getByRole('heading', { name: '航线探索' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '当前在途航班' })).toBeVisible();
    expect(screen.getAllByText('CA981').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '交换起点和终点' })).toBeVisible();
    expect(screen.getByText(/基于公开航班信息和实时位置归并/)).toBeVisible();
  });

  it('does not present an empty airport observation as a measured zero', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={{ ...demoData, flights: [] }} mapEnabled={false} />);

    await user.click(screen.getByRole('tab', { name: '机场' }));

    expect(screen.getAllByText('当前未获得记录').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0 架$/)).not.toBeInTheDocument();
  });

  it('applies reliable flight filters immediately and resets them', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '打开图层与筛选' }));
    expect(screen.getByRole('dialog', { name: '筛选与图层' })).toBeVisible();

    fireEvent.change(screen.getByRole('slider', { name: '最大高度' }), {
      target: { value: '9000' },
    });
    expect(screen.queryByRole('button', { name: /应用筛选/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置筛选' })).toBeVisible();
    expect(screen.getByText('已显示 2 / 8 架航班')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(screen.getByRole('slider', { name: '最大高度' })).toHaveValue('13000');
    expect(screen.queryByText('已显示 2 / 8 架航班')).not.toBeInTheDocument();
  });

  it('enables the weather switch and disables only it while loading', async () => {
    weatherRadarState.loading = true;
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '打开图层与筛选' }));

    expect(screen.getByRole('checkbox', { name: '天气雷达加载中' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '航空底图' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: '实时航班' })).toBeEnabled();
  });

  it('opens source health as a full page and returns to the preserved map context', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    const statusTrigger = screen.getByRole('button', { name: '实时位置，部分覆盖' });
    await user.click(statusTrigger);

    expect(screen.getByRole('region', { name: '数据覆盖与服务状态' })).toBeVisible();
    expect(screen.queryByRole('main', { name: '全球实时航班地图' })).not.toBeInTheDocument();
    expect(screen.getByText('ADSB.lol')).toBeVisible();
    expect(screen.getByText('OpenSky Network')).toBeVisible();
    expect(screen.getByText('Airplanes.live')).toBeVisible();
    expect(screen.getByText('部分区域更新延迟')).toBeVisible();
    expect(screen.getAllByText(/最后成功时间/).length).toBeGreaterThan(0);
    expect(screen.getByText(/当前航班数不代表全球实际在途总数/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: '返回地图' }));

    expect(screen.queryByRole('region', { name: '数据覆盖与服务状态' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: '全球实时航班地图' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'CA981' })).toBeVisible();
    expect(statusTrigger).toHaveFocus();
  });

  it('returns from the full-page source health view with Escape', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '实时位置，部分覆盖' }));
    expect(screen.getByRole('region', { name: '数据覆盖与服务状态' })).toBeVisible();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: '数据覆盖与服务状态' })).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: '全球实时航班地图' })).toBeVisible();
  });

  it('does not report all services healthy before source status is available', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={{ ...demoData, sourceStatuses: [] }} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '实时位置，等待来源状态' }));

    expect(screen.getByRole('status')).toHaveTextContent('尚未获得来源状态');
    expect(screen.getByText('尚未获得数据源状态')).toBeVisible();
    expect(screen.queryByText('全部服务正常')).not.toBeInTheDocument();
  });

  it('keeps static map context available when every realtime source is unavailable', () => {
    const unavailableData = {
      ...demoData,
      sourceStatuses: demoData.sourceStatuses.map((status) => ({
        ...status,
        state: 'down' as const,
      })),
    };

    render(<AppShell initialData={unavailableData} mapEnabled={false} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '实时位置来源全部不可用，地图和机场静态信息仍可使用。',
    );
  });

  it('opens complete flight details and returns to the selected map context', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '查看完整详情' }));
    expect(screen.getByRole('heading', { name: '实时飞行数据' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '航班事件' })).toBeVisible();
    expect(screen.getByText('B-2482')).toBeVisible();
    expect(screen.getByRole('heading', { name: '补充资料' })).toBeVisible();
    expect(screen.queryByText('演示数据趋势')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回地图' }));
    expect(screen.getByLabelText('实时航班地图')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'CA981' })).toBeVisible();
  });

  it('labels an ADSBdb-derived route and separates provenance from inference', async () => {
    const user = userEvent.setup();
    const inferredData = {
      ...demoData,
      flights: [
        {
          ...demoData.flights[0]!,
          inferredFields: ['origin', 'destination'],
          fieldSources: [
            {
              field: 'origin' as const,
              providerId: 'adsbdb',
              observedAt: demoData.flights[0]!.observedAt,
              inferred: true,
              confidence: 0.65,
            },
          ],
        },
      ],
    };
    render(<AppShell initialData={inferredData} mapEnabled={false} />);
    expect(screen.getByRole('heading', { name: 'CA981' })).toBeVisible();
    expect(screen.getByText('数据来源')).toBeVisible();
    expect(screen.getByText('路线推断')).toBeVisible();
    expect(screen.getByRole('button', { name: '查看完整详情' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: '查看完整详情' }));
    expect(screen.getByRole('heading', { name: '路线推断' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '补充资料' })).toBeVisible();
  });

  it('expands the mobile flight summary from its default half-height drawer', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    const panel = screen.getByLabelText('航班详情');
    expect(panel).toHaveAttribute('data-drawer-state', 'half');
    await user.click(screen.getByRole('button', { name: '展开航班详情抽屉' }));
    expect(panel).toHaveAttribute('data-drawer-state', 'full');
  });

  it('filters airport exploration and keeps selection in the same detail state', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('tab', { name: '机场' }));
    await user.click(screen.getByRole('button', { name: '热门机场' }));

    expect(screen.getByRole('button', { name: '热门机场' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('按大型枢纽排序')).toBeVisible();
    expect(screen.getByRole('button', { name: /纽约约翰·肯尼迪国际机场/ })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /北京首都国际机场/ }));
    expect(screen.getByRole('heading', { name: 'PEK' })).toBeVisible();
  });

  it('reselects route endpoints and renders an honest empty result', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('tab', { name: '航线' }));
    await user.click(screen.getByRole('button', { name: /选择到达机场/ }));
    expect(screen.getByRole('listbox', { name: '到达机场选项' })).toBeVisible();

    await user.type(screen.getByRole('searchbox', { name: '搜索到达机场' }), 'PVG');
    await user.click(screen.getByRole('option', { name: /PVG 上海浦东国际机场/ }));

    expect(screen.getByText('PEK → PVG')).toBeVisible();
    expect(screen.getByText('当前没有匹配的在途航班')).toBeVisible();
    expect(screen.getByText(/不代表官方完整班次/)).toBeVisible();
  });

  it('controls the short playback window and focuses search from the keyboard', () => {
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    fireEvent.change(screen.getByRole('slider', { name: '航迹回看时间' }), {
      target: { value: '15' },
    });
    expect(screen.getByText('15 分钟前')).toBeVisible();
    expect(screen.getByRole('button', { name: '返回实时位置' })).toBeVisible();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('searchbox', { name: '搜索航班、机场或城市' })).toHaveFocus();
  });

  it('moves keyboard focus into an opened settings dialog and closes it with Escape', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '打开图层与筛选' }));
    expect(screen.getByRole('button', { name: '关闭筛选与图层' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '筛选与图层' })).not.toBeInTheDocument();
  });
});
