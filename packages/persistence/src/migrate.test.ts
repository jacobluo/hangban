import { describe, expect, it } from 'vitest';

import { sortMigrationNames, validateAppliedMigration } from './migrate';

describe('database migrations', () => {
  it('rejects a changed checksum for an applied migration', () => {
    expect(() =>
      validateAppliedMigration(
        { name: '0001.sql', checksum: 'old' },
        { name: '0001.sql', checksum: 'new' },
      ),
    ).toThrow('MIGRATION_CHECKSUM_MISMATCH');
  });

  it('sorts numbered SQL migrations deterministically', () => {
    expect(sortMigrationNames(['0010_last.sql', '0002_middle.sql', '0001_first.sql'])).toEqual([
      '0001_first.sql',
      '0002_middle.sql',
      '0010_last.sql',
    ]);
  });

  it('rejects migration files without a numeric prefix', () => {
    expect(() => sortMigrationNames(['migration.sql'])).toThrow('INVALID_MIGRATION_NAME');
  });
});
