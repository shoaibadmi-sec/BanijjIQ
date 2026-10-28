import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
test('pinned React source and integration overlays are present', () => {
  assert.ok(existsSync(new URL('../../apps/hisabiq-web/src/App.tsx', import.meta.url)));
  for (const path of ['overlay/src/index.tsx','overlay/src/integration/banijjApi.ts','overlay/src/integration/BackendGate.tsx','overlay/src/integration/LiveProductsPage.tsx']) {
    assert.ok(existsSync(new URL('../'+path, import.meta.url)),path);
  }
});
test('real backend authentication and read-only bootstrap use existing BanijjIQ routes', () => {
  const api=read('overlay/src/integration/banijjApi.ts');
  for (const endpoint of ['/api/auth/login','/api/auth/me','/api/auth/logout','/api/bootstrap']) assert.ok(api.includes(endpoint),endpoint);
  assert.ok(api.includes('Bearer '));
  assert.ok(api.includes('shererp_auth_token'));
  const gate=read('overlay/src/integration/BackendGate.tsx');
  assert.ok(gate.includes('not for live transactions'));
  assert.ok(gate.includes('Demo POS'));
  const products=read('overlay/src/integration/LiveProductsPage.tsx');
  assert.ok(products.includes('getBootstrap()'));
  assert.ok(products.includes('Read only'));
});
