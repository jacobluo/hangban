import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

import { realtimeClientMessageSchema } from '@hangban/contracts';

import type { FlightRepository } from '../repository';
import { createRealtimeBroadcaster } from './broadcaster';
import type { RealtimeHub } from './hub';

export function registerRealtimeSocket(
  app: FastifyInstance,
  repository: FlightRepository,
  hub: RealtimeHub,
  now: () => Date,
  pushIntervalMs = 10_000,
) {
  const broadcaster = createRealtimeBroadcaster(repository, (clientId) =>
    hub.unsubscribe(clientId),
  );
  const pushTimer = setInterval(() => broadcaster.tick(), pushIntervalMs);
  app.addHook('onClose', async () => clearInterval(pushTimer));
  app.register(websocket);
  app.register(async (scope) => {
    scope.get('/api/v1/live', { websocket: true }, (socket) => {
      const clientId = crypto.randomUUID();
      socket.on('message', (raw: { toString(): string }) => {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw.toString());
        } catch {
          socket.close(1008, 'Invalid JSON');
          return;
        }
        const message = realtimeClientMessageSchema.safeParse(parsedJson);
        if (!message.success) {
          socket.close(1008, 'Invalid message');
          return;
        }
        if (message.data.type === 'heartbeat') {
          socket.send(JSON.stringify({ type: 'heartbeat', at: now().toISOString() }));
          return;
        }
        const bbox = message.data.bbox;
        hub.subscribe(clientId, bbox);
        const { flights, sourceStatuses } = broadcaster.subscribe(clientId, socket, bbox);
        try {
          socket.send(
            JSON.stringify({
              type: 'subscription.ready',
              snapshot: { flights, observedAt: now().toISOString(), sourceStatuses },
            }),
          );
        } catch {
          broadcaster.unsubscribe(clientId);
        }
      });
      socket.on('close', () => {
        broadcaster.unsubscribe(clientId);
      });
    });
  });
}
