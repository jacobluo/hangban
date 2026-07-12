import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bboxSchema, airportListResponseSchema } from '@hangban/contracts';
import { nearbyFlights } from '@hangban/domain';

import type { FlightRepository } from '../repository';
import type { AirportStore } from '../airport-store';

const paramsSchema = z.object({ airportCode: z.string().min(3).max(4) });

export async function registerAirportRoutes(
  app: FastifyInstance,
  repository: FlightRepository,
  airportStore: AirportStore = repository.airportIndex(),
) {
  app.get('/api/v1/airports', async (request, reply) => {
    const query = z
      .object({
        bbox: z.string(),
        zoom: z.coerce.number().min(0).max(24),
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ code: 'INVALID_QUERY', message: '机场视野参数无效' });
    const bbox = bboxSchema.safeParse(query.data.bbox.split(',').map(Number));
    if (!bbox.success)
      return reply.code(400).send({ code: 'INVALID_QUERY', message: '机场视野参数无效' });
    try {
      return airportListResponseSchema.parse(
        await airportStore.queryViewport({
          bbox: bbox.data,
          zoom: query.data.zoom,
          limit: query.data.limit,
          ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_CURSOR')
        return reply.code(400).send({ code: 'INVALID_CURSOR', message: '分页游标无效' });
      return reply.code(503).send({ code: 'STATIC_DATA_UNAVAILABLE', message: '机场数据暂不可用' });
    }
  });

  app.get('/api/v1/airports/:airportCode', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success)
      return reply.code(400).send({ code: 'INVALID_PATH', message: '机场代码无效' });
    let airport;
    try {
      airport = await airportStore.findByCode(params.data.airportCode);
    } catch {
      return reply.code(503).send({ code: 'STATIC_DATA_UNAVAILABLE', message: '机场数据暂不可用' });
    }
    if (airport === undefined)
      return reply.code(404).send({ code: 'AIRPORT_NOT_FOUND', message: '未找到对应机场' });
    return airport;
  });

  app.get('/api/v1/airports/:airportCode/nearby-flights', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = z
      .object({ radiusKm: z.coerce.number().positive().max(500).default(150) })
      .safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ code: 'INVALID_QUERY', message: '机场范围参数无效' });
    let airport;
    try {
      airport = await airportStore.findByCode(params.data.airportCode);
    } catch {
      return reply.code(503).send({ code: 'STATIC_DATA_UNAVAILABLE', message: '机场数据暂不可用' });
    }
    if (airport === undefined)
      return reply.code(404).send({ code: 'AIRPORT_NOT_FOUND', message: '未找到对应机场' });
    return {
      airport,
      radiusKm: query.data.radiusKm,
      flights: nearbyFlights(repository.allFlights(), airport, query.data.radiusKm),
    };
  });
}
