import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const source=()=>readFileSync('scripts/preview/build-pr-config.mjs','utf8');
const configFile='wrangler.hisabiq-pr.generated.jsonc';
const prod=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const safeId='11111111-1111-4111-8111-111111111111';

function generate({id=safeId,withAssets=false}={}){
 const p=spawnSync(process.execPath,['scripts/preview/build-pr-config.mjs'],{
   encoding:'utf8',env:{...process.env,HISABIQ_PR_PREVIEW_D1_ID:id,
     HISABIQ_PR_PREVIEW_TEST_ASSETS:withAssets?'yes':'no'}});
 return p;
}

test('auto-preview config has a distinct Worker and preview-only DB, never production DB at top level',()=>{
 const p=generate(); assert.equal(p.status,0,p.stderr);
 const c=JSON.parse(readFileSync(configFile,'utf8'));
 assert.equal(c.name,'hisabiq-pr-preview');
 assert.equal(c.main,'server/runtime/cloudflare.ts');
 assert.equal(c.assets.directory,'./.generated/hisabiq-web/dist');
 assert.deepEqual(c.assets.run_worker_first,['/api/*']);
 assert.equal(c.workers_dev,true);
 assert.equal(c.d1_databases,undefined,'Do not bind any remote database on production settings');
 assert.equal(c.previews.d1_databases.length,1);
 assert.equal(c.previews.d1_databases[0].binding,'DB');
 assert.equal(c.previews.d1_databases[0].database_id,safeId);
 assert.equal(c.previews.d1_databases[0].database_name,'hisabiq-pr-preview-db');
 assert.equal(c.previews.d1_databases[0].migrations_dir,'migrations');
 assert.notEqual(c.previews.d1_databases[0].database_id,prod.d1_databases[0].database_id);
 assert.equal('routes' in c,false);
 assert.equal('route' in c,false);
});

test('auto-preview config refuses production DB, invalid values and absent Preview D1 ID',()=>{
 for(const id of ['',prod.d1_databases[0].database_id,'not-a-uuid']){
   const p=generate({id});
   assert.notEqual(p.status,0,'Dangerous/unknown ID must fail closed: '+id);
 }
});

test('automatic preview requires built React assets except for isolated contract test',()=>{
 const p=generate({withAssets:true});
 if(!existsSync('.generated/hisabiq-web/dist/index.html')){
   assert.notEqual(p.status,0);
   assert.match(p.stderr,/Build the pinned React app first/);
 }
});

test('Cloudflare build commands target React, exact Wrangler preview, and never production',()=>{
 const docs=readFileSync('docs/hisabiq-pr-auto-preview.md','utf8');
 const runner=readFileSync('scripts/preview/pr-preview-build.mjs','utf8');
 for(const term of ['npm run react:build','wrangler@4.135.0','build-pr-config.mjs'])
   assert.ok(runner.includes(term),'Missing safe step: '+term);
 for(const term of [
   'hisabiq-pr-preview',
   'hisabiq-pr-preview-db',
   'npm run preview:pr-build',
   'npm run preview:pr-deploy',
   'npm run preview:pr-no-production',
   'Enable Preview Builds',
   'HISABIQ_PR_PREVIEW_D1_ID',
   'Cloudflare Access'
 ])assert.ok(docs.includes(term),'Missing operator instruction: '+term);
 assert.ok(readFileSync('.gitignore','utf8').includes(configFile),'Never commit generated D1 config');
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 assert.ok(pkg.scripts['preview:pr-build'].includes('pr-preview-build.mjs'));
 assert.ok(pkg.scripts['preview:pr-deploy'].includes('wrangler preview'));
 assert.ok(!pkg.scripts['preview:pr-deploy'].includes('wrangler deploy'));
 assert.ok(pkg.scripts['preview:pr-no-production'].includes('no-production-deploy'));
 assert.ok(!runner.includes('wrangler d1 migrations apply'),'Unreviewed PR must not auto-migrate shared D1');
 assert.ok(!docs.includes('shererp-new-db --remote'),'No production migration instructions');
});
