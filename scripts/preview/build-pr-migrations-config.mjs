/**
 * One-time operator-only migration config for the shared SYNTHETIC PR demo D1.
 * Must NEVER be executed automatically for unreviewed PR branches.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const prod=JSON.parse(readFileSync(resolve('wrangler.jsonc'),'utf8'));
const raw=(process.env.HISABIQ_PR_PREVIEW_D1_ID||'').trim();
assert.match(raw,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  'Provide a valid demo-only HISABIQ_PR_PREVIEW_D1_ID');
assert.equal(prod.d1_databases?.length,1,'Review current production D1 settings before migration');
assert.notEqual(raw.toLowerCase(),prod.d1_databases[0].database_id.toLowerCase(),
  'REFUSING: cannot generate migrations config for production D1');
const demo='hisabiq-pr-preview-db';
assert.notEqual(demo,prod.d1_databases[0].database_name);
const conf={
  $schema:'./node_modules/wrangler/config-schema.json',
  name:'hisabiq-pr-preview-migrations',
  d1_databases:[{
    binding:'DEMO_DB',database_name:demo,database_id:raw,
    migrations_dir:'migrations'
  }]
};
const file='wrangler.hisabiq-pr-migrations.generated.jsonc';
writeFileSync(resolve(file),JSON.stringify(conf,null,2)+'\n',{mode:0o600});
console.log('Generated one-time D1 migration config for '+demo+'.');
console.log('Review remote database name + UUID before running:');
console.log('npx wrangler d1 migrations apply DEMO_DB --remote --config '+file);
console.log('Not executing remote migrations. Never use production credentials/data.');
