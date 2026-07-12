import { z } from 'zod';

export const airportSchema = z
  .object({
    iata: z.string().length(3).optional(),
    icao: z.string().length(4).optional(),
    name: z.string().min(1),
    city: z.string().min(1),
    localizedCity: z.string().trim().min(1).optional(),
    country: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    elevationM: z.number().nullable().default(null),
    type: z.enum(['large_airport', 'medium_airport', 'small_airport']).default('large_airport'),
  })
  .refine((airport) => airport.iata !== undefined || airport.icao !== undefined, {
    message: 'An airport requires an IATA or ICAO code',
  });

export type Airport = z.infer<typeof airportSchema>;

export const airportListResponseSchema = z.object({
  airports: z.array(airportSchema),
  nextCursor: z.string().min(1).nullable(),
  totalInViewport: z.number().int().nonnegative(),
});

export type AirportListResponse = z.infer<typeof airportListResponseSchema>;
