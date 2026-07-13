// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SourceStatus } from '@hangban/contracts';

import { demoData } from '../lib/demo-data';
import { DataStatus } from './data-status';
import { FlightDetailsPage } from './flight-details-page';
import { FlightPanel } from './flight-panel';
import { PlaybackControl } from './playback-control';
import { RouteExplorer } from './route-explorer';

const originalTimeZone = process.env.TZ;
const observedAt = '2026-07-11T08:00:00.000Z';
const flight = { ...demoData.flights[0]!, observedAt };

beforeAll(() => {
  process.env.TZ = 'Asia/Shanghai';
});

afterAll(() => {
  process.env.TZ = originalTimeZone;
});

describe('browser-local time surfaces', () => {
  it('shows a compact observation time in the flight panel', async () => {
    const { container } = render(
      <FlightPanel flight={flight} onClose={vi.fn()} onOpenDetails={vi.fn()} />,
    );

    expect(await screen.findByText('16:00 GMT+8')).toBeVisible();
    expect(container.querySelector('time')).toHaveAttribute('dateTime', observedAt);
  });

  it('shows full local observation times on the flight details page', async () => {
    const { container } = render(
      <FlightDetailsPage flight={flight} airports={demoData.airports} onBack={vi.fn()} />,
    );

    expect(await screen.findAllByText('2026/7/11 16:00:00 GMT+8')).toHaveLength(3);
    expect(container.querySelectorAll('time')).toHaveLength(3);
    expect(container).not.toHaveTextContent(' UTC');
  });

  it('shows the latest route observation as full local time', async () => {
    const origin = demoData.airports.find((airport) => airport.iata === 'PEK')!;
    const destination = demoData.airports.find((airport) => airport.iata === 'JFK')!;
    render(
      <RouteExplorer
        airports={demoData.airports}
        flights={[flight]}
        origin={origin}
        destination={destination}
        onOriginChange={vi.fn()}
        onDestinationChange={vi.fn()}
        onFlightSelect={vi.fn()}
        onFocusRoute={vi.fn()}
      />,
    );

    expect(await screen.findByText('2026/7/11 16:00:00 GMT+8')).toBeVisible();
  });

  it('keeps playback arithmetic in timestamps and formats only the result', async () => {
    render(<PlaybackControl minutes={15} lastUpdatedAt={observedAt} onChange={vi.fn()} />);

    const playbackTime = await screen.findByText('15:45 GMT+8');
    expect(playbackTime).toHaveAttribute('dateTime', '2026-07-11T07:45:00.000Z');
  });

  it('shows the compact latest-success time in the global status trigger', async () => {
    const statuses: SourceStatus[] = [
      { providerId: 'adsb-lol', state: 'healthy', lastSuccessAt: observedAt },
    ];
    render(<DataStatus statuses={statuses} onOpen={vi.fn()} />);

    expect(await screen.findByText('16:00 GMT+8')).toBeVisible();
  });
});
