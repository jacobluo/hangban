import type { FastifyInstance } from 'fastify';

import type { FlightRepository } from '../repository';

export async function registerStatusRoutes(
  app: FastifyInstance,
  repository: FlightRepository,
  readiness: () => Promise<boolean> = async () => true,
) {
  app.get('/api/v1/data-sources/status', async () => ({ statuses: repository.sourceStatuses() }));
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      if (await readiness()) return { status: 'ready' };
    } catch {
      // Readiness deliberately hides infrastructure details.
    }
    return reply.code(503).send({ status: 'unavailable' });
  });
}
