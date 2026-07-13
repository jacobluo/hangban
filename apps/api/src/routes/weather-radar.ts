import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { weatherRadarStatusSchema } from '@hangban/contracts';

import { type WeatherRadarService, WeatherRadarServiceError } from '../weather-radar-service';

const tileParametersSchema = z.object({
  frameId: z.string().regex(/^frame-[0-9]+$/),
  z: z.coerce.number().int().min(0).max(7),
  x: z.coerce.number().int().nonnegative(),
  y: z.coerce.number().int().nonnegative(),
});

const invalidRequest = (reply: FastifyReply) =>
  reply.code(400).send({
    code: 'WEATHER_RADAR_REQUEST_INVALID',
    message: '天气雷达瓦片请求无效',
  });

const frameUnavailable = (reply: FastifyReply) =>
  reply.code(404).send({
    code: 'WEATHER_RADAR_FRAME_UNAVAILABLE',
    message: '天气雷达帧不可用',
  });

const upstreamUnavailable = (reply: FastifyReply) =>
  reply.code(503).send({
    code: 'WEATHER_RADAR_UPSTREAM_UNAVAILABLE',
    message: '天气雷达数据暂不可用',
  });

export async function registerWeatherRadarRoutes(
  app: FastifyInstance,
  service: WeatherRadarService,
) {
  app.get('/api/v1/weather/radar', async (_request, reply) => {
    try {
      return weatherRadarStatusSchema.parse(await service.status());
    } catch {
      return upstreamUnavailable(reply);
    }
  });

  app.get('/api/v1/weather/radar/tiles/:frameId/:z/:x/:y.png', async (request, reply) => {
    const parsed = tileParametersSchema.safeParse(request.params);
    if (
      !parsed.success ||
      parsed.data.x >= 2 ** parsed.data.z ||
      parsed.data.y >= 2 ** parsed.data.z
    ) {
      return invalidRequest(reply);
    }

    try {
      const { frameId, z, x, y } = parsed.data;
      const bytes = await service.tile(frameId, z, x, y);
      return reply
        .header('content-type', 'image/png')
        .header('cache-control', 'public, max-age=0, must-revalidate')
        .send(Buffer.from(bytes));
    } catch (error) {
      if (error instanceof WeatherRadarServiceError) {
        if (error.code === 'INVALID_REQUEST') return invalidRequest(reply);
        if (error.code === 'FRAME_UNAVAILABLE') return frameUnavailable(reply);
      }
      return upstreamUnavailable(reply);
    }
  });
}
