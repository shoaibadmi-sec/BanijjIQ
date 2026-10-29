import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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


test('manual default-branch launcher pins reviewed PR #9 and prevents accidental deploy',()=>{
  const launcher=read('.github/workflows/hisabiq-hosted-preview-dispatch.yml');
  for(const marker of ["name: Authorize isolated HisabIQ React preview","workflow_dispatch:",
    "github.ref == 'refs/heads/main'","inputs.confirm_isolated_preview == 'ISOLATED-PREVIEW-ONLY'",
    "reviewed_commit_sha:","repos/$GITHUB_REPOSITORY/pulls/9",
    '"$REVIEWED_SHA" != "$actual"',"name: hisabiq-react-preview",
    "needs: verify-reviewed-commit","scripts/preview/preflight-remote-db.mjs"])
    assert.ok(launcher.includes(marker), marker);
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
