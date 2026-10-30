import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read=(file)=>readFileSync(file,'utf8');
const workflow=read('.github/workflows/hisabiq-react-build.yml');
const generated=read('scripts/preview/build-config.mjs');
const smoke=read('scripts/preview/remote-smoke.mjs');

test('preview deploy requires manual input, explicit confirmation and feature branch',()=>{
  for(const term of [
    "github.event_name == 'workflow_dispatch'",
    "inputs.deploy_hosted_preview == true",
    "inputs.confirm_isolated_preview == 'ISOLATED-PREVIEW-ONLY'",
    "github.ref == 'refs/heads/feat/hisabiq-react-api'",
    'environment:',
    'name: hisabiq-react-preview',
    'needs: react-build'
  ])assert.ok(workflow.includes(term),term);
  assert.ok(!workflow.includes('deploy-hosted-preview:\n    runs-on:'));
});

test('preview Worker and D1 names are fixed and protected from production IDs',()=>{
  assert.ok(generated.includes("const previewName='banijjiq-hisabiq-react-preview'"));
  assert.ok(generated.includes("const previewDatabase='banijjiq-hisabiq-react-preview-db'"));
  assert.ok(generated.includes('REFUSING: preview D1 ID is the production D1 database ID'));
  assert.ok(generated.includes('workers_dev:true'));
  assert.ok(generated.includes("run_worker_first:['/api/*']"));
  assert.ok(generated.includes('migrations_dir:'));
});

test('remote migrations and Worker deploy use ONLY generated preview config',()=>{
  const config='wrangler.hisabiq-preview.generated.jsonc';
  const steps=[
    'wrangler d1 migrations apply DB --remote --config '+config,
    'wrangler deploy --config '+config,
    'wrangler secret put SETUP_SECRET --config '+config
  ];
  for(const command of steps)assert.ok(workflow.includes(command),command);
  assert.ok(!workflow.includes('wrangler deploy --config wrangler.jsonc'));
  assert.ok(!workflow.includes('wrangler d1 migrations apply DB --remote --config wrangler.jsonc'));
});

test('hosted smoke never posts inventory, cash, invoices or returns',()=>{
  assert.ok(smoke.includes("const workerName='banijjiq-hisabiq-react-preview'"));
  assert.ok(smoke.includes('/api/setup/status'));
  assert.ok(smoke.includes('/api/auth/login'));
  assert.ok(smoke.includes('/api/bootstrap'));
  assert.ok(smoke.includes('/api/pos/bootstrap'));
  assert.ok(!smoke.includes("call('POST','/api/pos/sales'"));
  assert.ok(!smoke.includes("call('POST','/api/products'"));
  assert.ok(!smoke.includes("call('POST','/api/pos/cash-session/start'"));
  assert.ok(!smoke.includes('console.log(response.token)'));
});


test('manual hosted-preview launcher verifies reviewed current main, then rechecks before any remote D1 writes',()=>{
  const launcher=read('.github/workflows/hisabiq-hosted-preview-dispatch.yml');
  for(const marker of ["name: Authorize isolated HisabIQ React preview","workflow_dispatch:",
    "github.ref == 'refs/heads/main'","inputs.confirm_isolated_preview == 'ISOLATED-PREVIEW-ONLY'",
    "reviewed_commit_sha:","repos/$GITHUB_REPOSITORY/commits/main",
    '"$REVIEWED_SHA" != "$actual"',"name: hisabiq-react-preview",
    "needs: verify-reviewed-commit","scripts/preview/preflight-remote-db.mjs",
    "name: Recheck current main before any remote writes"])
    assert.ok(launcher.includes(marker), marker);
  const recheck=launcher.indexOf('name: Recheck current main before any remote writes');
  const migrate=launcher.indexOf('name: Apply migrations to verified remote PREVIEW D1');
  assert.ok(recheck>0&&migrate>recheck,'Main SHA must be rechecked before remote D1 migrations');
  assert.ok(!launcher.includes('repos/$GITHUB_REPOSITORY/pulls/9'),'Merged PR #9 is not a release candidate');
  assert.ok(!launcher.includes('\n  push:'));
  assert.ok(!launcher.includes('\n  pull_request:'));
  assert.ok(!launcher.includes('wrangler deploy --config wrangler.jsonc'));
});


test('Phase 14 hosted browser acceptance is read-only, scoped and locally rehearsed',()=>{
  const browser=read('scripts/preview/browser-acceptance.mjs');
  const local=read('d1-checks/phase13-browser.mjs');
  for(const marker of [
    "const workerName='banijjiq-hisabiq-react-preview'",
    'https:',
    'workers\\.dev',
    '127.0.0.1:8793',
    "method==='GET'",
    "method==='POST'&&uri.pathname==='/api/auth/login'",
    "await route.abort('blockedbyclient')",
    "assert.equal(result.blockedWrites.length,0",
    "assert.equal(result.browserErrors.length,0",
    "await page.getByText('Sign in · BanijjIQ').waitFor",
    "await page.keyboard.press('F2')",
    "await window.axe.run",
    "for(const width of [390,768,1440])"
  ])assert.ok(browser.includes(marker),marker);
  assert.ok(!browser.includes("fetch(base+'/api/pos/sales'"),'Preview acceptance may not write sales');
  assert.ok(!browser.includes("fetch(base+'/api/sales-returns'"),'Preview acceptance may not write refunds');
  assert.ok(local.includes('runBrowserAcceptance({'));
  assert.ok(local.includes('allowLocal:true'));
  assert.ok(local.includes("assert.equal(r.passed.length,15)"));
});

test('Phase 14 read-only hosted acceptance cannot run on PR or without protected deploy',()=>{
  const launcher=read('.github/workflows/hisabiq-hosted-preview-dispatch.yml');
  const branch=read('.github/workflows/hisabiq-react-build.yml');
  for(const workflow of [launcher,branch]){
    assert.ok(workflow.includes('  accept-hosted-preview:\n'));
    assert.ok(workflow.includes('name: hisabiq-react-preview'));
    assert.ok(workflow.includes('node scripts/preview/browser-acceptance.mjs --remote'));
    assert.ok(workflow.includes('submodules: recursive'));
    assert.ok(workflow.includes('hisabiq-hosted-read-only-acceptance'));
    assert.ok(workflow.includes("inputs.confirm_isolated_preview == 'ISOLATED-PREVIEW-ONLY'"));
    assert.ok(workflow.includes('npx playwright install --with-deps chromium'));
  }
  assert.ok(launcher.includes('needs: deploy-isolated-preview'));
  assert.ok(branch.includes('needs: deploy-hosted-preview'));
  assert.ok(launcher.includes('node d1-checks/phase12.mjs'));
  assert.ok(launcher.includes('node d1-checks/phase13-browser.mjs'));
  assert.ok(branch.includes('node d1-checks/phase13-browser.mjs'));
});


test('first-run and repeat-run hosted preview smoke preserve setup header and JSON shape',()=>{
  // Run the actual remote-smoke module in a child with a synthetic HTTP boundary.
  // No Cloudflare API calls, deployed Workers or credential disclosure.
  const child=String.raw`
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker='https://banijjiq-hisabiq-react-preview.preview-ci-fixture.workers.dev';
let initialized=process.env.SMOKE_ALREADY_SETUP==='yes';
let setupPosts=0,blockedSetupPosts=0,loginPosts=0;
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{
 status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,options={})=>{
 const url=String(input),method=options.method||'GET';
 if(url==='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID+'/workers/subdomain')
   return respond({success:true,result:{subdomain:'preview-ci-fixture'}});
 assert.ok(url.startsWith(worker+'/')||url===worker+'/', 'Unexpected external URL');
 const path=url.slice(worker.length);
 const headers=options.headers||{};
 const body=options.body===undefined?null:JSON.parse(String(options.body));
 if(path==='/api/health')return respond({ok:true});
 if(path==='/api/setup/status')return respond({ok:true,setupRequired:!initialized});
 if(path==='/api/setup/admin'){
   if(!headers['x-setup-secret']){
     blockedSetupPosts++;
     assert.ok(body&&body.phone==='000','Unauthorized setup must be real JSON');
     return respond({ok:false,error:'Administrator setup requires a valid setup secret'},403);
   }
   assert.equal(headers['x-setup-secret'],process.env.HISABIQ_PREVIEW_SETUP_SECRET);
   assert.equal(headers['Content-Type'],'application/json');
   assert.equal(body?.fullName,'Preview Administrator');
   assert.equal(body?.phone,process.env.HISABIQ_PREVIEW_ADMIN_PHONE);
   assert.equal(body?.password,process.env.HISABIQ_PREVIEW_ADMIN_PASSWORD);
   assert.equal(initialized,false,'Unexpected admin reset');
   initialized=true;setupPosts++;
   return respond({ok:true,token:'local-ci-token'});
 }
 if(path==='/api/auth/login'){
   assert.equal(headers['Content-Type'],'application/json');
   assert.equal(body?.phone,process.env.HISABIQ_PREVIEW_ADMIN_PHONE);
   assert.equal(body?.password,process.env.HISABIQ_PREVIEW_ADMIN_PASSWORD);
   assert.equal(initialized,true);
   loginPosts++;
   return respond({ok:true,token:'local-ci-token',user:{role:'admin'}});
 }
 if(path==='/api/auth/me'){
   assert.equal(headers.Authorization,'Bearer local-ci-token');
   return respond({ok:true,user:{role:'admin'}});
 }
 if(path==='/api/bootstrap'){
   assert.equal(headers.Authorization,'Bearer local-ci-token');
   return respond({ok:true,products:[]});
 }
 if(path==='/api/pos/bootstrap'){
   assert.equal(headers.Authorization,'Bearer local-ci-token');
   return respond({ok:true,products:[],customers:[]});
 }
 if(path==='/')return new Response('<!doctype html><html></html>',{status:200,
   headers:{'content-type':'text/html'}});
 throw Error('Unexpected preview smoke endpoint: '+method+' '+path);
};
await import('./scripts/preview/remote-smoke.mjs');
const artifact=JSON.parse(readFileSync('preview-checks/output/hosted-smoke.json','utf8'));
assert.equal(artifact.failed.length,0);
assert.equal(artifact.passed.length,6);
assert.equal(setupPosts,process.env.SMOKE_ALREADY_SETUP==='yes'?0:1);
assert.equal(blockedSetupPosts,1);
assert.equal(loginPosts,1);
`;
  for(const already of ['no','yes']){
    const proc=spawnSync(process.execPath,['--input-type=module','-e',child],{
      cwd:process.cwd(),encoding:'utf8',timeout:30000,
      env:{...process.env,SMOKE_ALREADY_SETUP:already,
        CLOUDFLARE_ACCOUNT_ID:'11111111111111111111111111111111',
        CLOUDFLARE_API_TOKEN:'SYNTHETIC-NONPRODUCTION-TEST-TOKEN',
        HISABIQ_PREVIEW_D1_ID:'11111111-1111-4111-8111-111111111111',
        HISABIQ_PREVIEW_SETUP_SECRET:'SYNTHETIC-NEVER-DEPLOY-SETUP-SECRET',
        HISABIQ_PREVIEW_ADMIN_PHONE:'01000009999',
        HISABIQ_PREVIEW_ADMIN_PASSWORD:'SYNTHETIC-LOCAL-ONLY-PASSWORD',
        GITHUB_STEP_SUMMARY:''}
    });
    assert.equal(proc.status,0,'Mocked smoke '+already+' failed: '+(proc.stderr||proc.stdout).slice(-1800));
    assert.match(proc.stdout,/Preview verified at/);
  }
});

test('real demo data seeding requires an explicit isolated-preview approval and no production remote writes',()=>{
  const workflow=read('.github/workflows/hisabiq-preview-demo-seed.yml');
  const client=read('scripts/preview/demo-seed-remote.mjs');
  const plan=read('scripts/preview/demo-seed-plan.mjs');
  for(const marker of [
    'workflow_dispatch:',
    "github.ref == 'refs/heads/main'",
    "inputs.confirm_demo_seeding == 'SEED-ISOLATED-DEMO-ONLY'",
    'name: hisabiq-react-preview',
    'node scripts/preview/preflight-remote-db.mjs',
    'node --import tsx scripts/preview/demo-seed-remote.mjs --apply',
    'Recheck exact current main immediately before preview writes'
  ])assert.ok(workflow.includes(marker),marker);
  assert.ok(!workflow.includes(String.fromCharCode(10)+'  push:'));
  assert.ok(!workflow.includes(String.fromCharCode(10)+'  pull_request:'));
  assert.ok(!workflow.includes('wrangler d1 migrations apply DB --remote'));
  assert.ok(!workflow.includes('wrangler deploy'));
  assert.ok(client.includes('https://banijjiq-hisabiq-react-preview.shoaibadmisec.workers.dev'));
  assert.ok(client.includes('HISABIQ_DEMO_SEED_CONFIRM'));
  assert.ok(!client.includes('shererp-new'));
  assert.ok(plan.includes('Preview database already contains live records'));
  assert.ok(plan.includes("await safe('POST','/api/pos/sales'"));
  assert.ok(plan.includes("await safe('POST','/api/purchases'"));
});
