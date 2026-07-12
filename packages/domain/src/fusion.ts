import type { Flight } from '@hangban/contracts';

import { classifyFreshness } from './freshness';

export function fuseFlights(candidates: Flight[], now: Date = new Date()): Flight[] {
  const groups = new Map<string, Flight[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.icao24) ?? [];
    group.push(candidate);
    groups.set(candidate.icao24, group);
  }

  return [...groups.values()].map((group) => {
    const byFreshness = group.toSorted(
      (left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt),
    );
    const freshest = byFreshness[0];
    if (freshest === undefined) throw new Error('Flight fusion group cannot be empty');

    const sources = [...new Set(group.flatMap((item) => item.sources))].toSorted();
    const confidence = Math.min(
      1,
      Math.max(...group.map((item) => item.confidence)) + (sources.length - 1) * 0.02,
    );

    return {
      ...freshest,
      freshness: classifyFreshness(freshest.observedAt, now),
      confidence,
      sources,
    };
  });
}
