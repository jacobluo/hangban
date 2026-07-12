import { useCallback, useEffect, useRef, useState } from 'react';
import type { Airport, Bbox } from '@hangban/contracts';
import { fetchViewportAirports } from './api-client';

export function useAirports(initial: Airport[], enabled = true) {
  const [airports, setAirports] = useState(initial),
    [total, setTotal] = useState(initial.length),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const bboxRef = useRef<Bbox | null>(null),
    controllerRef = useRef<AbortController | null>(null);
  const updateViewport = useCallback(
    (bbox: Bbox) => {
      bboxRef.current = bbox;
      if (!enabled) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);
      void fetchViewportAirports(bbox, undefined, controller.signal)
        .then((result) => {
          if (controller.signal.aborted || controllerRef.current !== controller) return;
          setAirports(result.airports);
          setTotal(result.totalInViewport);
          setNextCursor(result.nextCursor);
        })
        .catch((reason: unknown) => {
          if (!(reason instanceof DOMException && reason.name === 'AbortError'))
            setError('当前视野机场加载失败');
        })
        .finally(() => {
          if (controllerRef.current === controller) setLoading(false);
        });
    },
    [enabled],
  );
  const loadMore = useCallback(() => {
    if (!enabled || !bboxRef.current || !nextCursor || loading) return;
    setLoading(true);
    void fetchViewportAirports(bboxRef.current, nextCursor)
      .then((result) => {
        setAirports((current) => [
          ...current,
          ...result.airports.filter(
            (airport) =>
              !current.some((item) => (item.icao ?? item.iata) === (airport.icao ?? airport.iata)),
          ),
        ]);
        setNextCursor(result.nextCursor);
        setTotal(result.totalInViewport);
        setError(null);
      })
      .catch(() => setError('更多机场加载失败'))
      .finally(() => setLoading(false));
  }, [enabled, loading, nextCursor]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  return { airports, total, nextCursor, loading, error, updateViewport, loadMore };
}
