import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { FlightRepository } from '../repository';

export async function registerFlightRoutes(app: FastifyInstance, repository: FlightRepository) {
  app.get('/api/v1/flights/:flightId', async (request, reply) => {
    const params = z.object({ flightId: z.string().min(1) }).safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ code: 'INVALID_PATH', message: '航班标识无效' });
    const flight = repository.findFlight(params.data.flightId);
    if (flight === undefined)
      return reply.code(404).send({ code: 'FLIGHT_NOT_FOUND', message: '未找到对应航班' });
    return flight;
  });
}
