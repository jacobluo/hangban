// @vitest-environment jsdom

import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useWeatherRadar } from './use-weather-radar';

function availableStatus(frameId = 'frame-1783929600') {
  return {
    available: true as const,
    providerId: 'rainviewer' as const,
    frameId,
    frameTime: '2026-07-13T08:00:00.000Z',
    freshness: 'latest' as const,
    tileTemplate: `/api/v1/weather/radar/tiles/${frameId}/{z}/{x}/{y}.png`,
    attribution: {
      label: 'Weather radar by RainViewer' as const,
      url: 'https://www.rainviewer.com/' as const,
    },
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('useWeatherRadar', () => {
  it('does not fetch until enabled and exposes a resolved internal tile URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(availableStatus()));
    const { result, rerender } = renderHook(
      ({ enabled }) => useWeatherRadar(enabled, { fetchImpl: fetchImpl as typeof fetch }),
      { initialProps: { enabled: false } },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.status?.available).toBe(true));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/api/v1/weather/radar',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.radar?.frameId).toBe('frame-1783929600');
    expect(result.current.tileTemplate).toBe(
      'http://127.0.0.1:4000/api/v1/weather/radar/tiles/frame-1783929600/{z}/{x}/{y}.png',
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('starts only one request for an enabled StrictMode mount', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(availableStatus()));
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(
      () => useWeatherRadar(true, { fetchImpl: fetchImpl as typeof fetch }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.radar).not.toBeNull());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight request when disabled and clears transient state', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useWeatherRadar(enabled, { fetchImpl: fetchImpl as typeof fetch }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.loading).toBe(true));
    rerender({ enabled: false });

    expect(requestSignal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.radar).toBeNull();
    expect(result.current.tileTemplate).toBeNull();
  });

  it('aborts an in-flight request on unmount', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const { unmount } = renderHook(() =>
      useWeatherRadar(true, { fetchImpl: fetchImpl as typeof fetch }),
    );

    await waitFor(() => expect(requestSignal).toBeDefined());
    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not let an old request overwrite a newer enable cycle', async () => {
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(jsonResponse(availableStatus('frame-1783930200')));
    const { result, rerender } = renderHook(
      ({ enabled }) => useWeatherRadar(enabled, { fetchImpl: fetchImpl as typeof fetch }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    rerender({ enabled: false });
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.radar?.frameId).toBe('frame-1783930200'));

    await act(async () => {
      resolveFirst(jsonResponse(availableStatus('frame-1783929600')));
      await first;
    });

    expect(result.current.radar?.frameId).toBe('frame-1783930200');
  });

  it('maps an unavailable response to a non-fatal weather error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        available: false,
        providerId: 'rainviewer',
        reason: 'UPSTREAM_UNAVAILABLE',
      }),
    );
    const { result } = renderHook(() =>
      useWeatherRadar(true, { fetchImpl: fetchImpl as typeof fetch }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status?.available).toBe(false);
    expect(result.current.radar).toBeNull();
    expect(result.current.tileTemplate).toBeNull();
    expect(result.current.error).toBe('天气雷达暂时不可用');
  });

  it('validates the shared contract and retries without toggling the layer', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...availableStatus(), tileTemplate: 'https://bad' }))
      .mockResolvedValueOnce(jsonResponse(availableStatus()));
    const { result } = renderHook(() =>
      useWeatherRadar(true, { fetchImpl: fetchImpl as typeof fetch }),
    );

    await waitFor(() => expect(result.current.error).toBe('天气雷达暂时不可用'));
    expect(result.current.status).toBeNull();

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.radar?.frameId).toBe('frame-1783929600'));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });
});
