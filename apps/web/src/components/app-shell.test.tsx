// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { mapFlyTo } = vi.hoisted(() => ({ mapFlyTo: vi.fn() }));

vi.mock('./flight-map', async () => {
  const React = await import('react');
  return {
    FlightMap: React.forwardRef(function MockFlightMap(_props, ref) {
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

  it('opens map layers, applies a reliable flight filter and resets it', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '打开图层与筛选' }));
    expect(screen.getByRole('dialog', { name: '筛选与图层' })).toBeVisible();

    fireEvent.change(screen.getByRole('slider', { name: '最大高度' }), {
      target: { value: '9000' },
    });
    expect(screen.getByRole('button', { name: /应用筛选，显示 2 架航班/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /应用筛选/ }));

    expect(screen.queryByRole('dialog', { name: '筛选与图层' })).not.toBeInTheDocument();
    expect(screen.getByText('已显示 2 / 8 架航班')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '打开图层与筛选' }));
    await user.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(screen.getByRole('slider', { name: '最大高度' })).toHaveValue('13000');
    expect(screen.getByRole('button', { name: /应用筛选，显示 8 架航班/ })).toBeVisible();
  });

  it('opens source health details from the compact data status', async () => {
    const user = userEvent.setup();
    render(<AppShell initialData={demoData} mapEnabled={false} />);

    await user.click(screen.getByRole('button', { name: '实时位置，部分覆盖' }));

    expect(screen.getByRole('dialog', { name: '数据覆盖与服务状态' })).toBeVisible();
    expect(screen.getByText('ADSB.lol')).toBeVisible();
    expect(screen.getByText('OpenSky Network')).toBeVisible();
    expect(screen.getByText('Airplanes.live')).toBeVisible();
    expect(screen.getByText('部分区域更新延迟')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '关闭数据状态' }));
    expect(screen.queryByRole('dialog', { name: '数据覆盖与服务状态' })).not.toBeInTheDocument();
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
});
