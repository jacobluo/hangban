import { describe, expect, it } from 'vitest';

import { createPostgresPool } from './client';

describe('createPostgresPool', () => {
  it('handles idle connection errors so infrastructure loss does not terminate the API process', async () => {
    const pool = createPostgresPool({ connectionString: 'postgresql://test:test@127.0.0.1/test' });
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    await pool.end();
  });
});
