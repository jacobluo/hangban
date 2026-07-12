import { useCallback, useEffect, useRef, useState } from 'react';

import {
  realtimeServerMessageSchema,
  type Bbox,
  type Flight,
  type SourceStatus,
} from '@hangban/contracts';

import { fetchMapSnapshot, realtimeUrl } from './api-client';
import type { AppData } from './demo-data';

export type RealtimeConnectionState = 'loading' | 'online' | 'reconnecting' | 'offline';

export function useRealtimeFlights(initialData: AppData, enabled: boolean) {
  const [flights, setFlights] = useState(initialData.flights);
  const [sourceStatuses, setSourceStatuses] = useState(initialData.sourceStatuses);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>(
    enabled ? 'loading' : 'online',
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(
    initialData.flights[0]?.observedAt ?? null,
  );
  const [retryVersion, setRetryVersion] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const viewportRef = useRef<Bbox>([-180, -90, 180, 90]);

  useEffect(() => {
    if (!enabled) {
      setConnectionState('online');
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let reconnectAttempt = 0;

    const scheduleReconnect = () => {
      if (disposed) return;
      reconnectAttempt += 1;
      setConnectionState(reconnectAttempt >= 3 ? 'offline' : 'reconnecting');
      reconnectTimer = setTimeout(
        () => void connect(false),
        Math.min(1_000 * 2 ** (reconnectAttempt - 1), 10_000),
      );
    };

    const connect = async (initial: boolean) => {
      if (disposed) return;
      setConnectionState(initial ? 'loading' : 'reconnecting');
      controller = new AbortController();
      try {
        const snapshot = await fetchMapSnapshot(viewportRef.current, controller.signal);
        if (disposed) return;
        setFlights(snapshot.flights);
        setSourceStatuses(snapshot.sourceStatuses);
        setLastUpdatedAt(snapshot.observedAt);

        const socket = new WebSocket(realtimeUrl());
        socketRef.current = socket;
        socket.addEventListener('open', () => {
          if (disposed) return;
          reconnectAttempt = 0;
          setConnectionState('online');
          socket.send(JSON.stringify({ type: 'subscription.update', bbox: viewportRef.current }));
        });
        socket.addEventListener('message', (event) => {
          let json: unknown;
          try {
            json = JSON.parse(String(event.data));
          } catch {
            return;
          }
          const parsed = realtimeServerMessageSchema.safeParse(json);
          if (!parsed.success) return;
          const message = parsed.data;
          if (message.type === 'subscription.ready') {
            setFlights(message.snapshot.flights);
            setSourceStatuses(message.snapshot.sourceStatuses);
            setLastUpdatedAt(message.snapshot.observedAt);
          } else if (message.type === 'flight.upsert') {
            setFlights((current) => [
              ...current.filter((flight) => flight.id !== message.flight.id),
              message.flight,
            ]);
            setLastUpdatedAt(message.flight.observedAt);
          } else if (message.type === 'flight.remove') {
            setFlights((current) => current.filter((flight) => flight.id !== message.flightId));
          } else if (message.type === 'source.status') {
            setSourceStatuses((current) => [
              ...current.filter((status) => status.providerId !== message.status.providerId),
              message.status,
            ]);
          }
        });
        socket.addEventListener('close', () => {
          if (socketRef.current === socket) socketRef.current = null;
          scheduleReconnect();
        });
        socket.addEventListener('error', () => socket.close());
      } catch {
        scheduleReconnect();
      }
    };

    void connect(true);
    return () => {
      disposed = true;
      controller?.abort();
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled, retryVersion]);

  const updateViewport = useCallback((bbox: Bbox) => {
    viewportRef.current = bbox;
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'subscription.update', bbox }));
    }
  }, []);

  const retry = useCallback(() => setRetryVersion((version) => version + 1), []);

  return {
    flights,
    sourceStatuses,
    connectionState,
    lastUpdatedAt,
    retry,
    updateViewport,
  };
}

export type RealtimeFlightsState = {
  flights: Flight[];
  sourceStatuses: SourceStatus[];
  connectionState: RealtimeConnectionState;
  lastUpdatedAt: string | null;
};
