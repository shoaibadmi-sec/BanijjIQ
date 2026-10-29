/**
 * Build a strongly isolated hosted-preview config.
 * The production Wrangler file is read for comparison only, never modified.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const productionPath=resolve('wrangler.jsonc');
const generatedPath=resolve('wrangler.hisabiq-preview.generated.jsonc');
const source=JSON.parse(readFileSync(productionPath,'utf8'));
const previewName='banijjiq-hisabiq-react-preview';
const previewDatabase='banijjiq-hisabiq-react-preview-db';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function build(id){
  assert.match(id,uuid,'Preview D1 ID must be a valid UUID');
  assert.equal(source.d1_databases?.length,1,'Review changes to production bindings before continuing');
  const productionId=source.d1_databases[0].database_id;
  assert.notEqual(id.toLowerCase(),String(productionId).toLowerCase(),
    'REFUSING: preview D1 ID is the production D1 database ID');
  assert.notEqual(previewName,source.name,'Preview Worker must have a different name');
  assert.notEqual(previewDatabase,source.d1_databases[0].database_name);
  assert.ok(existsSync(resolve('.generated/hisabiq-web/dist/index.html')) ||
            process.argv.includes('--self-test'),'Build React before preview deployment');
  const config={
    $schema:'./node_modules/wrangler/config-schema.json',
    name:previewName,
    main:'server/runtime/cloudflare.ts',
    compatibility_date:source.compatibility_date,
    workers_dev:true,
    assets:{
      directory:'./.generated/hisabiq-web/dist',
      binding:'ASSETS',
      not_found_handling:'single-page-application',
      run_worker_first:['/api/*']
    },
    d1_databases:[{
      binding:'DB',
      database_name:previewDatabase,
      database_id:id,
      migrations_dir:'migrations'
    }]
  };
  assert.equal(config.d1_databases[0].binding,'DB');
  assert.equal(config.assets.run_worker_first[0],'/api/*');
  assert.ok(!('routes' in config)&&!('route' in config),'No custom production routes');
  return config;
}

if(process.argv.includes('--self-test')){
  const mock='11111111-1111-4111-8111-111111111111';
  assert.deepEqual(build(mock).d1_databases.map(x=>x.database_id),[mock]);
  assert.throws(()=>build(source.d1_databases[0].database_id),/REFUSING/);
  assert.throws(()=>build('not-a-d1-id'),/valid UUID/);
  console.log('PASS: preview config differs from production and rejects its D1 ID');
}else{
  const id=(process.env.HISABIQ_PREVIEW_D1_ID||'').trim();
  const config=build(id);
  writeFileSync(generatedPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
  console.log('Created isolated preview config: Worker='+config.name+
    ', D1='+config.d1_databases[0].database_name+
    '. Database UUID not logged.');
}
