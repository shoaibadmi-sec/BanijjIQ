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
  assert.ok(gate.includes('Only the Products and basic POS routes use real APIs'));
  const products=read('overlay/src/integration/LiveProductsPage.tsx');
  assert.ok(products.includes('getBootstrap()'));
  assert.ok(products.includes('Read only'));
});

test('main HisabIQ Products and POS routes are replaced, demos remain explicitly separate', () => {
  const prep=read('../scripts/prepare-hisabiq-react.mjs');
  assert.ok(prep.includes('<Route path="products" element={<LiveProducts />} />'));
  assert.ok(prep.includes('<Route path="pos" element={<LivePos />} />'));
  assert.ok(prep.includes('pos-design-preview'));
  assert.ok(prep.includes('products-design-preview'));
});
test('live POS uses existing transaction endpoint and makes unsupported products unavailable', () => {
  const api=read('overlay/src/integration/banijjApi.ts');
  for(const url of ['/api/pos/bootstrap','/api/pos/cash-session/start','/api/pos/sales']) assert.ok(api.includes(url),url);
  const page=read('overlay/src/integration/LivePosPage.tsx');
  for(const marker of ['ProductCombobox','getPosBootstrap','postSale(payload)','startCashSession(amount)',
    'canUseModule(user, \'pos\', \'add\')','reviewOpen','Confirm and post','single-unit',
    '!p.trackSerial && !p.trackExpiry && p.stock > 0','line.qty > line.product.stock',
    'paidAmount > total','paymentType: PosSalePayload']) assert.ok(page.includes(marker),marker);
  assert.ok(!page.includes('previewInvoiceCounter'),'Fake invoices cannot appear as posted');
});
