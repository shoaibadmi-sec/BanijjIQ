/**
 * Source-controlled Cloudflare Workers Builds configuration for native branch Previews.
 * Writes an IGNORED Wrangler file using the EXISTING React staging D1 UUID from build settings.
 * Never reads, writes, or inherits production D1 as a Preview binding.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const production=JSON.parse(readFileSync(resolve('wrangler.jsonc'),'utf8'));
const generated='wrangler.hisabiq-pr.generated.jsonc';
const previewName='banijjiq-hisabiq-react-preview';
const databaseName='banijjiq-hisabiq-react-preview-db';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function build(databaseId){
  assert.match(databaseId,uuid,'HISABIQ_PREVIEW_D1_ID must be a D1 UUID');
  assert.equal(production.name,'shererp-new','Review production Worker name change first');
  assert.equal(production.d1_databases?.length,1,'Review production D1 bindings first');
  assert.notEqual(databaseId.toLowerCase(),production.d1_databases[0].database_id.toLowerCase(),
    'REFUSING: PR Preview D1 ID equals the production database ID');
  assert.notEqual(databaseName,production.d1_databases[0].database_name);
  assert.notEqual(previewName,production.name);
  return {
    $schema:'./node_modules/wrangler/config-schema.json',
    name:previewName,
    main:'server/runtime/cloudflare.ts',
    compatibility_date:production.compatibility_date,
    workers_dev:true,
    assets:{
      directory:'./.generated/hisabiq-web/dist',binding:'ASSETS',
      not_found_handling:'single-page-application',run_worker_first:['/api/*']
    },
    // Intentionally NO top-level D1, production routes or automatic migrations.
    // A production deploy of this Worker cannot reach an existing ERP database.
    previews:{
      vars:{HISABIQ_PREVIEW:'true'},
      d1_databases:[{
        binding:'DB',database_name:databaseName,database_id:databaseId,
        migrations_dir:'migrations'
      }]
    }
  };
}

const id=(process.env.HISABIQ_PREVIEW_D1_ID||'').trim();
const testWithoutAssets=process.env.HISABIQ_PR_PREVIEW_TEST_ASSETS==='no';
assert.ok(testWithoutAssets||existsSync(resolve('.generated/hisabiq-web/dist/index.html')),
  'Build the pinned React app first: npm run react:build');
const config=build(id);
writeFileSync(resolve(generated),JSON.stringify(config,null,2)+'\n',{mode:0o600});
console.log('Created native PR Previews config for EXISTING Worker '+config.name+
  ' and EXISTING D1 '+databaseName+'; main preview and production Worker are unchanged.');
