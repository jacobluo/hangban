import type { Flight } from '@hangban/contracts';

export function classifyFreshness(observedAt: string, now: Date = new Date()): Flight['freshness'] {
  const ageMs = Math.max(0, now.getTime() - Date.parse(observedAt));
  if (ageMs <= 30_000) return 'live';
  if (ageMs <= 120_000) return 'delayed';
  return 'stale';
}
