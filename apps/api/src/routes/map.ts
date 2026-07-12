import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bboxSchema } from '@hangban/contracts';
import { isInsideBbox } from '@hangban/domain';

import type { FlightRepository } from '../repository';

const querySchema = z.object({ bbox: z.string() });

export async function registerMapRoutes(
  app: FastifyInstance,
  repository: FlightRepository,
  now: () => Date,
  realtimeAvailable: () => boolean = () => true,
) {
  app.get('/api/v1/map/snapshot', async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    const numbers = query.success ? query.data.bbox.split(',').map(Number) : [];
    const bbox = bboxSchema.safeParse(numbers);
    if (!bbox.success)
      return reply.code(400).send({ code: 'INVALID_QUERY', message: '地图范围无效' });
    if (!realtimeAvailable())
      return reply
        .code(503)
        .send({ code: 'REALTIME_DATA_UNAVAILABLE', message: '实时航班数据暂不可用' });
    return {
      flights: repository.allFlights().filter((flight) => isInsideBbox(flight, bbox.data)),
      observedAt: now().toISOString(),
      sourceStatuses: repository.sourceStatuses(),
    };
  });
}
