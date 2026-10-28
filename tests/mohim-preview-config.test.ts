import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Cloudflare branch Previews bind DB to staging, never to production D1', () => {
  const production = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const migration = JSON.parse(readFileSync('wrangler.preview-migrations.jsonc', 'utf8'));
  const top = production.d1_databases?.[0], preview = production.previews?.d1_databases?.[0], target = migration.d1_databases?.[0];
  assert.ok(top && preview && target);
  assert.equal(top.binding, 'DB');
  assert.equal(top.database_name, 'shererp-new-db');
  assert.equal(preview.binding, 'DB');
  assert.equal(preview.database_name, 'shererp-bundle-preview-db');
  assert.notEqual(preview.database_id, top.database_id);
  assert.equal(target.binding, 'PREVIEW_DB');
  assert.equal(target.database_id, preview.database_id);
  assert.equal(target.database_name, preview.database_name);
  assert.equal(target.migrations_dir, 'migrations');
});
