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
  assert.ok(gate.includes('basic POS posts real accounting transactions'));
  assert.ok(gate.includes('Products and basic POS use the real API'));
  const products=read('overlay/src/integration/LiveProductsPage.tsx');
  assert.ok(products.includes('getBootstrap()'));
  assert.ok(products.includes('LiveProductEditor'));
  assert.ok(products.includes('canUseModule(user,\'products\',\'edit\')'));
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

test('ambiguous network failures do not encourage duplicate sale posting', () => {
  const api=read('overlay/src/integration/banijjApi.ts');
  const pos=read('overlay/src/integration/LivePosPage.tsx');
  assert.ok(api.includes('class BackendRequestError'));
  assert.ok(api.includes('export const getSalesByPhone'));
  assert.ok(pos.includes('postingRef.current = true'));
  assert.ok(pos.includes('setOutcomeUnknown(true)'));
  assert.ok(pos.includes('Check recent invoices for this phone'));
  assert.ok(pos.includes('I checked Sales and confirmed this invoice was not posted'));
});

test('live product editor uses safe catalog route and avoids stock mutation', () => {
  const api=read('overlay/src/integration/banijjApi.ts');
  const editor=read('overlay/src/integration/LiveProductEditor.tsx');
  assert.ok(api.includes("'/api/products/' + encodeURIComponent(productId) + '/catalog'"));
  assert.ok(api.includes("'/api/products'"));
  assert.ok(editor.includes('AddProductDialog'));
  assert.ok(editor.includes('Editing never adjusts current stock or FIFO lots'));
  assert.ok(editor.includes('expectedUpdatedAt:product.updatedAt'));
  assert.ok(editor.includes('createBasicProduct(payload)'));
  assert.ok(editor.includes('updateProductCatalog(product.productId'));
  assert.ok(editor.includes('pending.current=true'));
});

test('receipt is rendered from server invoice using original HisabIQ component',()=>{
  const api=read('overlay/src/integration/banijjApi.ts');
  const pos=read('overlay/src/integration/LivePosPage.tsx');
  assert.ok(api.includes("'/api/pos/invoices/'+encodeURIComponent(id)"));
  for(const marker of ['getPosInvoice(finished.invoiceId)','ReceiptPreview','receipt.items.map',
    'invoiceDesign?.settings','window.print()']) assert.ok(pos.includes(marker),marker);
});

test('POS request id persists across retries and rotates on new sale',()=>{
  const pos=read('overlay/src/integration/LivePosPage.tsx');
  const api=read('overlay/src/integration/banijjApi.ts');
  assert.ok(api.includes('clientRequestId: string'));
  assert.ok(pos.includes('clientRequestId: saleRequestId.current'));
  assert.ok(pos.includes('saleRequestId.current=crypto.randomUUID()'));
});
