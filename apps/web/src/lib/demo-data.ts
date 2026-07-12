import type { Airport, Flight, SourceStatus } from '@hangban/contracts';
import { airports, createDemoFlights, createDemoSourceStatuses } from '@hangban/testkit';

export type AppData = {
  airports: Airport[];
  flights: Flight[];
  sourceStatuses: SourceStatus[];
};

const demoNow = new Date('2026-07-11T08:00:00.000Z');

export const demoData: AppData = {
  airports,
  flights: createDemoFlights(demoNow),
  sourceStatuses: createDemoSourceStatuses(demoNow),
};

export const runtimeInitialData: AppData = {
  airports: [],
  flights: [],
  sourceStatuses: [],
};
