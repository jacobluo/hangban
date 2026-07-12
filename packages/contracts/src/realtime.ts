import { z } from 'zod';

import { flightSchema } from './flight';

export const bboxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine((bbox) => bbox[1] < bbox[3], { message: 'South must be less than north' });

export type Bbox = z.infer<typeof bboxSchema>;

export const realtimeClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscription.update'),
    bbox: bboxSchema,
  }),
  z.object({ type: z.literal('heartbeat') }),
]);

export const sourceStatusSchema = z.object({
  providerId: z.string().min(1),
  state: z.enum(['healthy', 'degraded', 'down']),
  lastAttemptAt: z.iso.datetime({ offset: true }).optional(),
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  lastRecordCount: z.number().int().nonnegative().optional(),
  errorCode: z
    .enum(['RATE_LIMITED', 'AUTH_FAILED', 'TIMEOUT', 'INVALID_RESPONSE', 'UPSTREAM_ERROR'])
    .optional(),
  message: z.string().optional(),
});

export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const mapSnapshotSchema = z.object({
  flights: z.array(flightSchema),
  observedAt: z.iso.datetime({ offset: true }),
  sourceStatuses: z.array(sourceStatusSchema),
});

export type MapSnapshot = z.infer<typeof mapSnapshotSchema>;

export const realtimeServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscription.ready'), snapshot: mapSnapshotSchema }),
  z.object({ type: z.literal('flight.upsert'), flight: flightSchema }),
  z.object({ type: z.literal('flight.remove'), flightId: z.string().min(1) }),
  z.object({ type: z.literal('source.status'), status: sourceStatusSchema }),
  z.object({ type: z.literal('heartbeat'), at: z.iso.datetime({ offset: true }) }),
]);

export type RealtimeClientMessage = z.infer<typeof realtimeClientMessageSchema>;
export type RealtimeServerMessage = z.infer<typeof realtimeServerMessageSchema>;
