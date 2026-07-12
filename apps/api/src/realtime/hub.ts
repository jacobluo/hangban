import type { Bbox, Flight, RealtimeServerMessage } from '@hangban/contracts';
import { isInsideBbox } from '@hangban/domain';

export type RealtimeHub = ReturnType<typeof createRealtimeHub>;

export function createRealtimeHub() {
  const subscriptions = new Map<string, Bbox>();
  const queues = new Map<string, RealtimeServerMessage[]>();

  return {
    subscribe(clientId: string, bbox: Bbox) {
      subscriptions.set(clientId, bbox);
      queues.set(clientId, []);
    },
    unsubscribe(clientId: string) {
      subscriptions.delete(clientId);
      queues.delete(clientId);
    },
    activeBboxes(): Bbox[] {
      return [...subscriptions.values()].map((bbox) => [...bbox] as Bbox);
    },
    publish(flights: Flight[]) {
      for (const [clientId, bbox] of subscriptions) {
        const queue = queues.get(clientId);
        if (queue === undefined) continue;
        for (const flight of flights) {
          if (isInsideBbox(flight, bbox)) queue.push({ type: 'flight.upsert', flight });
        }
      }
    },
    drain(clientId: string): RealtimeServerMessage[] {
      const queued = queues.get(clientId) ?? [];
      queues.set(clientId, []);
      return queued;
    },
  };
}
