import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { runMigrations } from './migrate.js';
import { SqliteDatabase } from './sqlite.js';

mkdirSync(dirname(config.databasePath), { recursive: true });
const db = new SqliteDatabase(config.databasePath);

try {
  const summary = runMigrations(db.native, config.migrationsDir);
  if (summary.applied.length) console.log(`Applied: ${summary.applied.join(', ')}`);
  else console.log('Database is already up to date.');
} finally {
  db.close();
}
