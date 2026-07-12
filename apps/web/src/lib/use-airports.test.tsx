// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Airport } from '@hangban/contracts';
import { useAirports } from './use-airports';

const airport = (iata: string, longitude: number): Airport => ({
  iata,
  name: iata,
  city: iata,
  country: 'CN',
  latitude: 22,
  longitude,
  elevationM: null,
  type: 'large_airport',
});

describe('useAirports', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('applies only the latest viewport response', async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ airports: [airport('LHR', 0)], nextCursor: null, totalInViewport: 1 }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useAirports([], true));
    act(() => result.current.updateViewport([113, 22, 114, 23]));
    act(() => result.current.updateViewport([-1, 50, 1, 52]));
    await waitFor(() => expect(result.current.airports[0]?.iata).toBe('LHR'));
    resolveFirst(
      new Response(
        JSON.stringify({ airports: [airport('SZX', 113.8)], nextCursor: null, totalInViewport: 1 }),
      ),
    );
    await act(async () => Promise.resolve());
    expect(result.current.airports[0]?.iata).toBe('LHR');
  });
});
