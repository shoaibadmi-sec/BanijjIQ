import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

const MIGRATION_TABLE = 'schema_migrations';

export type MigrationSummary = {
  applied: string[];
  alreadyApplied: number;
};

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function runMigrations(db: Database.Database, migrationsDir: string): MigrationSummary {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      migration TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const lookup = db.prepare(`SELECT checksum FROM ${MIGRATION_TABLE} WHERE migration = ?`);
  const record = db.prepare(`INSERT INTO ${MIGRATION_TABLE} (migration, checksum) VALUES (?, ?)`);
  const applied: string[] = [];

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const hash = checksum(sql);
    const existing = lookup.get(file) as { checksum: string } | undefined;

    if (existing) {
      if (existing.checksum !== hash) {
        throw new Error(`Migration ${file} was modified after it was applied.`);
      }
      continue;
    }

    const applyOne = db.transaction(() => {
      db.exec(sql);
      record.run(file, hash);
    });
    applyOne.immediate();
    applied.push(file);
  }

  return { applied, alreadyApplied: files.length - applied.length };
}
