import { z } from 'zod';

export const weatherRadarFreshnessSchema = z.enum(['latest', 'delayed', 'historical-cache']);

export const weatherRadarUnavailableReasonSchema = z.enum([
  'DISABLED',
  'UPSTREAM_UNAVAILABLE',
  'NO_VALID_FRAME',
  'FRAME_EXPIRED',
]);

export const weatherRadarAvailableStatusSchema = z.object({
  available: z.literal(true),
  providerId: z.literal('rainviewer'),
  frameId: z.string().regex(/^frame-[0-9]+$/),
  frameTime: z.iso.datetime({ offset: true }),
  freshness: weatherRadarFreshnessSchema,
  tileTemplate: z
    .string()
    .regex(/^\/api\/v1\/weather\/radar\/tiles\/frame-[0-9]+\/\{z\}\/\{x\}\/\{y\}\.png$/),
  attribution: z.object({
    label: z.literal('Weather radar by RainViewer'),
    url: z.literal('https://www.rainviewer.com/'),
  }),
});

export const weatherRadarUnavailableStatusSchema = z.object({
  available: z.literal(false),
  providerId: z.literal('rainviewer'),
  reason: weatherRadarUnavailableReasonSchema,
});

export const weatherRadarStatusSchema = z.discriminatedUnion('available', [
  weatherRadarAvailableStatusSchema,
  weatherRadarUnavailableStatusSchema,
]);

export type WeatherRadarFreshness = z.infer<typeof weatherRadarFreshnessSchema>;
export type WeatherRadarAvailableStatus = z.infer<typeof weatherRadarAvailableStatusSchema>;
export type WeatherRadarStatus = z.infer<typeof weatherRadarStatusSchema>;
