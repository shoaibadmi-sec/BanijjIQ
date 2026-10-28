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
