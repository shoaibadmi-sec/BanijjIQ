import { resolve } from 'node:path';

function readPort(value: string | undefined): number {
  const port = Number(value ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port between 1 and 65535.');
  }
  return port;
}

export const config = {
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: readPort(process.env.PORT),
  databasePath: resolve(process.env.SHERERP_DB_PATH?.trim() || './data/shererp.sqlite'),
  migrationsDir: resolve(process.env.SHERERP_MIGRATIONS_DIR?.trim() || './migrations')
};
