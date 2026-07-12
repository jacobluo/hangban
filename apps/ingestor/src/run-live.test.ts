import { describe, expect, it, vi } from 'vitest';

import { commitIfLeaseOwner } from './run-live';

describe('commitIfLeaseOwner', () => {
  it('does not collect or commit while another ingestor owns the lease', async () => {
    const collect = vi.fn();
    const commitCycle = vi.fn();
    await expect(
      commitIfLeaseOwner({
        lease: { acquire: vi.fn().mockResolvedValue(false), renew: vi.fn() },
        collect,
        store: { commitCycle },
      }),
    ).resolves.toBe('standby');
    expect(collect).not.toHaveBeenCalled();
    expect(commitCycle).not.toHaveBeenCalled();
  });

  it('commits a collected cycle only while the lease can be renewed', async () => {
    const cycle = { flights: [], statuses: [], observedAt: '2026-07-12T08:00:00.000Z' };
    const commitCycle = vi.fn().mockResolvedValue({ upsertedIds: [], removedIds: [] });
    await expect(
      commitIfLeaseOwner({
        lease: {
          acquire: vi.fn().mockResolvedValue(true),
          renew: vi.fn().mockResolvedValue(true),
        },
        collect: vi.fn().mockResolvedValue(cycle),
        store: { commitCycle },
      }),
    ).resolves.toBe('committed');
    expect(commitCycle).toHaveBeenCalledWith(cycle);
  });
});
