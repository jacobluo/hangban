import { z } from 'zod';

export const freshnessSchema = z.enum(['live', 'delayed', 'stale']);

export const flightFieldSourceSchema = z.object({
  field: z.enum(['airline', 'aircraftType', 'registration', 'origin', 'destination']),
  providerId: z.string().min(1),
  observedAt: z.iso.datetime({ offset: true }),
  inferred: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type FlightFieldSource = z.infer<typeof flightFieldSourceSchema>;

export const flightSchema = z
  .object({
    id: z.string().min(1),
    icao24: z.string().regex(/^[a-fA-F0-9]{6}$/),
    callsign: z.string().trim().min(2).max(12),
    airline: z.string().trim().min(1).optional(),
    aircraftType: z.string().trim().min(1).optional(),
    registration: z.string().trim().min(1).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    altitudeM: z.number().nonnegative().nullable(),
    groundSpeedKmh: z.number().nonnegative().nullable(),
    headingDeg: z.number().min(0).lt(360).nullable(),
    verticalRateMpm: z.number().nullable(),
    observedAt: z.iso.datetime({ offset: true }),
    freshness: freshnessSchema,
    confidence: z.number().min(0).max(1),
    sources: z.array(z.string().min(1)).min(1),
    origin: z.string().length(3).optional(),
    destination: z.string().length(3).optional(),
    inferredFields: z.array(z.string()).default([]),
    fieldSources: z.array(flightFieldSourceSchema).default([]),
  })
  .transform((flight) => {
    const inferredFields = new Set(flight.inferredFields);
    for (const source of flight.fieldSources) {
      if (source.inferred && (source.field === 'origin' || source.field === 'destination')) {
        inferredFields.add(source.field);
      }
    }
    return { ...flight, inferredFields: [...inferredFields] };
  });

export type Flight = z.infer<typeof flightSchema>;

export const routeSummarySchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  distanceKm: z.number().positive(),
  activeFlights: z.array(flightSchema),
  confidence: z.number().min(0).max(1),
  observedAt: z.iso.datetime({ offset: true }),
});

export type RouteSummary = z.infer<typeof routeSummarySchema>;
