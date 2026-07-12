import type { Bbox, Flight, SourceStatus } from '@hangban/contracts';
import { isInsideBbox } from '@hangban/domain';

import type { FlightRepository } from '../repository';

export type RealtimeSocket = { send(data: string): void };

type Client = { socket: RealtimeSocket; bbox: Bbox };
type FlightEntry = { flight: Flight; fingerprint: string };
type SourceStatusEntry = { status: SourceStatus; fingerprint: string };

function cloneFlight(flight: Flight): Flight {
  return {
    ...flight,
    sources: [...flight.sources],
    inferredFields: [...flight.inferredFields],
    fieldSources: [...flight.fieldSources],
  };
}

function cloneSourceStatus(status: SourceStatus): SourceStatus {
  return { ...status };
}

function flightFingerprint(flight: Flight): string {
  return JSON.stringify([
    flight.id,
    flight.icao24,
    flight.callsign,
    flight.airline ?? null,
    flight.aircraftType ?? null,
    flight.registration ?? null,
    flight.latitude,
    flight.longitude,
    flight.altitudeM,
    flight.groundSpeedKmh,
    flight.headingDeg,
    flight.verticalRateMpm,
    flight.observedAt,
    flight.freshness,
    flight.confidence,
    flight.sources,
    flight.origin ?? null,
    flight.destination ?? null,
    flight.inferredFields,
    flight.fieldSources,
  ]);
}

function sourceStatusFingerprint(status: SourceStatus): string {
  return JSON.stringify([
    status.state,
    status.lastAttemptAt ?? null,
    status.lastSuccessAt,
    status.lastRecordCount ?? null,
    status.errorCode ?? null,
    status.message ?? null,
  ]);
}

function flightEntries(flights: Flight[]): Map<string, FlightEntry> {
  return new Map(
    flights.map((candidate) => {
      const flight = cloneFlight(candidate);
      return [flight.id, { flight, fingerprint: flightFingerprint(flight) }];
    }),
  );
}

function sourceStatusEntries(statuses: SourceStatus[]): Map<string, SourceStatusEntry> {
  return new Map(
    statuses.map((candidate) => {
      const status = cloneSourceStatus(candidate);
      return [status.providerId, { status, fingerprint: sourceStatusFingerprint(status) }];
    }),
  );
}

export function createRealtimeBroadcaster(
  repository: FlightRepository,
  onDisconnect: (clientId: string) => void = () => undefined,
) {
  let flights = flightEntries(repository.allFlights());
  let sourceStatuses = sourceStatusEntries(repository.sourceStatuses());
  const clients = new Map<string, Client>();

  const disconnect = (clientId: string): void => {
    if (!clients.delete(clientId)) return;
    onDisconnect(clientId);
  };

  const send = (clientId: string, client: Client, message: unknown): boolean => {
    try {
      client.socket.send(JSON.stringify(message));
      return true;
    } catch {
      disconnect(clientId);
      return false;
    }
  };

  return {
    subscribe(clientId: string, socket: RealtimeSocket, bbox: Bbox) {
      clients.set(clientId, { socket, bbox: [...bbox] as Bbox });
      return {
        flights: [...flights.values()]
          .map(({ flight }) => flight)
          .filter((flight) => isInsideBbox(flight, bbox))
          .map(cloneFlight),
        sourceStatuses: [...sourceStatuses.values()].map(({ status }) => cloneSourceStatus(status)),
      };
    },
    unsubscribe: disconnect,
    tick() {
      const nextFlights = flightEntries(repository.allFlights());
      const flightChanges: Array<{ previous?: Flight; current?: Flight }> = [];
      for (const [id, current] of nextFlights) {
        const previous = flights.get(id);
        if (previous?.fingerprint !== current.fingerprint) {
          flightChanges.push({
            ...(previous === undefined ? {} : { previous: previous.flight }),
            current: current.flight,
          });
        }
      }
      for (const [id, previous] of flights) {
        if (!nextFlights.has(id)) flightChanges.push({ previous: previous.flight });
      }
      flights = nextFlights;

      const nextSourceStatuses = sourceStatusEntries(repository.sourceStatuses());
      const changedStatuses: SourceStatus[] = [];
      for (const [providerId, current] of nextSourceStatuses) {
        if (sourceStatuses.get(providerId)?.fingerprint !== current.fingerprint) {
          changedStatuses.push(current.status);
        }
      }
      sourceStatuses = nextSourceStatuses;

      for (const [clientId, client] of clients) {
        let connected = true;
        for (const { previous, current } of flightChanges) {
          const wasVisible = previous !== undefined && isInsideBbox(previous, client.bbox);
          const isVisible = current !== undefined && isInsideBbox(current, client.bbox);
          if (isVisible) {
            if (!send(clientId, client, { type: 'flight.upsert', flight: current })) {
              connected = false;
              break;
            }
          } else if (wasVisible) {
            if (!send(clientId, client, { type: 'flight.remove', flightId: previous.id })) {
              connected = false;
              break;
            }
          }
        }
        if (!connected) continue;
        for (const status of changedStatuses) {
          if (!send(clientId, client, { type: 'source.status', status })) break;
        }
      }
    },
    clientCount: () => clients.size,
    stats: () => ({
      clients: clients.size,
      globalFlightEntries: flights.size,
      globalSourceStatusEntries: sourceStatuses.size,
      perClientFlightEntries: 0 as const,
    }),
  };
}
