import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { SqliteDatabase } from './db/sqlite.js';

mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new SqliteDatabase(config.databasePath);
const migrationSummary = runMigrations(db.native, config.migrationsDir);
const app = createApp(db, process.env.BANIJJIQ_SETUP_SECRET);

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port
}, (info) => {
  console.log(`SherERP backend listening on http://${info.address}:${info.port}`);
  console.log(`SQLite database: ${config.databasePath}`);
  if (migrationSummary.applied.length) {
    console.log(`Applied migrations: ${migrationSummary.applied.join(', ')}`);
  }
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}. Closing SherERP backend.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
