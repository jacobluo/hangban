import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { FlightRepository } from '../repository';
import type { AirportStore } from '../airport-store';

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(20),
  types: z.string().optional(),
});

export async function registerSearchRoutes(
  app: FastifyInstance,
  repository: FlightRepository,
  airportStore: AirportStore = repository.airportIndex(),
) {
  app.get('/api/v1/search', async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ code: 'INVALID_QUERY', message: '搜索内容无效' });
    const value = query.data.q.toLocaleUpperCase();
    try {
      return {
        flights: repository
          .allFlights()
          .filter((flight) =>
            [
              flight.callsign,
              flight.airline ?? '',
              flight.origin ?? '',
              flight.destination ?? '',
            ].some((field) => field.toLocaleUpperCase().includes(value)),
          ),
        airports: (await airportStore.search(query.data.q, query.data.limit)).map(
          ({ airport, ...match }) => ({ ...airport, ...match }),
        ),
      };
    } catch {
      return reply.code(503).send({ code: 'STATIC_DATA_UNAVAILABLE', message: '机场数据暂不可用' });
    }
  });
}
