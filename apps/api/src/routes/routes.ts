import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { distanceKm, matchRouteFlights } from '@hangban/domain';

import type { FlightRepository } from '../repository';
import type { AirportStore } from '../airport-store';

const querySchema = z.object({
  origin: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),
  destination: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),
});

export async function registerRouteRoutes(
  app: FastifyInstance,
  repository: FlightRepository,
  now: () => Date,
  airportStore: AirportStore = repository.airportIndex(),
) {
  app.get('/api/v1/routes', async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success || query.data.origin === query.data.destination) {
      return reply.code(400).send({ code: 'INVALID_ROUTE', message: '起点和终点必须不同' });
    }
    let origin;
    let destination;
    try {
      [origin, destination] = await Promise.all([
        airportStore.findByCode(query.data.origin),
        airportStore.findByCode(query.data.destination),
      ]);
    } catch {
      return reply.code(503).send({ code: 'STATIC_DATA_UNAVAILABLE', message: '机场数据暂不可用' });
    }
    if (origin === undefined || destination === undefined) {
      return reply.code(404).send({ code: 'AIRPORT_NOT_FOUND', message: '未找到对应机场' });
    }
    const flights = matchRouteFlights(
      repository.allFlights(),
      query.data.origin,
      query.data.destination,
    );
    return {
      origin: query.data.origin,
      destination: query.data.destination,
      distanceKm: Math.round(
        distanceKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude),
      ),
      activeFlights: flights,
      confidence:
        flights.length === 0 ? 0.6 : Math.min(...flights.map((flight) => flight.confidence)),
      observedAt: now().toISOString(),
    };
  });
}
