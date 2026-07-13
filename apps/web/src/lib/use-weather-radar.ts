import { useCallback, useEffect, useState } from 'react';

import type { WeatherRadarAvailableStatus, WeatherRadarStatus } from '@hangban/contracts';

import { fetchWeatherRadarStatus, resolveApiUrl } from './api-client';

type Dependencies = {
  fetchImpl?: typeof fetch;
};

export type WeatherRadarState = {
  status: WeatherRadarStatus | null;
  radar: WeatherRadarAvailableStatus | null;
  tileTemplate: string | null;
  loading: boolean;
  error: string | null;
  retry(): void;
};

export function useWeatherRadar(
  enabled: boolean,
  dependencies: Dependencies = {},
): WeatherRadarState {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const [status, setStatus] = useState<WeatherRadarStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);

    // Deferring the request prevents React StrictMode's discarded setup pass
    // from issuing a duplicate network call.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const nextStatus = await fetchWeatherRadarStatus(controller.signal, fetchImpl);
        if (!current || controller.signal.aborted) return;
        setStatus(nextStatus);
        setError(nextStatus.available ? null : '天气雷达暂时不可用');
      } catch {
        if (!current || controller.signal.aborted) return;
        setStatus(null);
        setError('天气雷达暂时不可用');
      } finally {
        if (current && !controller.signal.aborted) setLoading(false);
      }
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, [enabled, fetchImpl, retryVersion]);

  const retry = useCallback(() => setRetryVersion((version) => version + 1), []);
  const radar = status?.available === true ? status : null;

  return {
    status,
    radar,
    tileTemplate: radar === null ? null : resolveApiUrl(radar.tileTemplate),
    loading,
    error,
    retry,
  };
}
