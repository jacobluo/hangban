import { describe, expect, it } from 'vitest';

import { createDemoFlights } from '@hangban/testkit';

import { advanceDemoFlights } from './demo-motion';

describe('advanceDemoFlights', () => {
  it('advances positions and observation time without changing identity', () => {
    const before = createDemoFlights(new Date('2026-07-11T08:00:00.000Z'));
    const after = advanceDemoFlights(before, new Date('2026-07-11T08:00:10.000Z'));
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.observedAt).toBe('2026-07-11T08:00:10.000Z');
    expect(after[0]?.longitude).not.toBe(before[0]?.longitude);
  });
});
