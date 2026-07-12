import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient } from 'pg';

export type MigrationRecord = { name: string; checksum: string };
export type MigrationResult = { applied: number; skipped: number };
export const defaultMigrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

export function sortMigrationNames(names: string[]): string[] {
  for (const name of names) {
    if (!/^\d{4}_[a-z0-9_-]+\.sql$/i.test(name)) throw new Error('INVALID_MIGRATION_NAME');
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function validateAppliedMigration(applied: MigrationRecord, current: MigrationRecord) {
  if (applied.name === current.name && applied.checksum !== current.checksum)
    throw new Error('MIGRATION_CHECKSUM_MISMATCH');
}

async function loadMigrations(directory: string) {
  const names = sortMigrationNames(
    (await readdir(directory)).filter((name) => name.endsWith('.sql')),
  );
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

async function applyMigration(client: PoolClient, migration: MigrationRecord & { sql: string }) {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [
      migration.name,
      migration.checksum,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function migrateDatabase(
  pool: Pool,
  directory = defaultMigrationsDirectory,
): Promise<MigrationResult> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('hangban:migrations'))");
    locked = true;
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const existing = await client.query<MigrationRecord>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const appliedByName = new Map(existing.rows.map((record) => [record.name, record]));
    let applied = 0;
    let skipped = 0;
    for (const migration of await loadMigrations(directory)) {
      const previous = appliedByName.get(migration.name);
      if (previous) {
        validateAppliedMigration(previous, migration);
        skipped += 1;
      } else {
        await applyMigration(client, migration);
        applied += 1;
      }
    }
    return { applied, skipped };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('hangban:migrations'))");
    client.release();
  }
}
