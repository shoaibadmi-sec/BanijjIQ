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
  const live=read('overlay/src/integration/products/useLiveProducts.ts');
  const catalog=read('overlay/src/integration/products/productApi.ts');
  assert.ok(products.includes('useLiveProducts(permitted)'));
  assert.ok(products.includes('MohimProductEditor'));
  assert.ok(products.includes('MohimProductActions'));
  assert.ok(products.includes('canUseModule(user,\'products\',\'edit\')'));
  assert.ok(live.includes('loadProductCatalog()'));
  assert.ok(catalog.includes("'/api/bootstrap'"));
  assert.ok(!products.includes('upsertProductPreview('));
});

test('main HisabIQ Products and POS routes are replaced, demos remain explicitly separate', () => {
  const prep=read('../scripts/prepare-hisabiq-react.mjs');
  assert.ok(prep.includes('<Route path="products" element={<Products />} />'));
  assert.ok(prep.includes('patchLiveProducts('));
  assert.ok(prep.includes('<Route path="pos" element={<LivePos />} />'));
  assert.ok(prep.includes('pos-design-preview'));
  assert.ok(prep.includes('products-design-preview'));
});
test('live POS uses existing transaction endpoint and makes unsupported products unavailable', () => {
  const api=read('overlay/src/integration/banijjApi.ts');
  for(const url of ['/api/pos/bootstrap','/api/pos/cash-session/start','/api/pos/sales']) assert.ok(api.includes(url),url);
  const page=read('overlay/src/integration/LivePosPage.tsx');
  for(const marker of ['CartTable','getPosBootstrap','postSale(payload)','startCashSession(amount,startSessionRequestId.current)',
    'canUseModule(user, \'pos\', \'add\')','reviewOpen','Confirm and post','quoteLiveUnits',
    'getPosTrackingOptions(id)','SerialPickerDialog','LiveStockShortageDialog','line.qty > line.product.stock',
    'paidAmount > total','paymentType: PosSalePayload']) assert.ok(page.includes(marker),marker);
  assert.ok(page.includes('sourcePosCartBridge') && page.includes('unitProfileRevision'), 'Original source cart must map 2–4-unit quantities to live posting contract');
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


test('Phase 13 React uses only real tracking and vendor APIs, not demo vendor stores',()=>{
  const api=read('overlay/src/integration/banijjApi.ts');
  const pos=read('overlay/src/integration/LivePosPage.tsx');
  const dialog=read('overlay/src/integration/LiveStockShortageDialog.tsx');
  for(const route of ['/api/pos/products/','/tracking-options','/api/pos/vendors',
    '/api/sales-returns/search','/api/sales-returns/'])
    assert.ok(api.includes(route),route);
  assert.ok(pos.includes('SerialPickerDialog'));
  assert.ok(pos.includes('getPosTrackingOptions(id)'));
  assert.ok(pos.includes('fulfillmentMode: l.source.mode'));
  assert.ok(pos.includes('line.serialNumbers.length!==line.qty'));
  assert.ok(pos.includes('line.source.mode==='));
  assert.ok(dialog.includes('createPosVendor('));
  assert.ok(dialog.includes('role="radiogroup"'));
  assert.ok(!dialog.includes('partyPreviewStore'),'Only live vendor IDs are permitted');
});

test('Phase 13 real return route preserves source Sales preview and blocks uncertain refunds',()=>{
  const prep=read('../scripts/prepare-hisabiq-react.mjs');
  const returns=read('overlay/src/integration/LiveSalesReturnsPage.tsx');
  assert.ok(prep.includes('live-sales-returns'));
  assert.ok(!prep.includes('path="sales" element={<LiveSalesReturns'));
  for(const check of ['getReturnableInvoice(id)','postSalesReturn(payload)',
    'getSalesReturnHistory()','setUnknown(true)','availableSerials','SerialPickerDialog',
    "canUseModule(user,'returns','add')",'Review real return','total>sale.netSale'])
    assert.ok(returns.includes(check),check);
});


test('source-faithful Dashboard uses authenticated report data and never renders preview balances', async () => {
  const { patchLiveDashboardSource } = await import('../../scripts/preview/patch-live-dashboard.mjs');
  const root=path=>readFileSync(new URL('../../apps/hisabiq-web/src/'+path,import.meta.url),'utf8');
  const original={
    dashboard:root('pages/Dashboard.tsx'),
    metric:root('components/dashboard/MetricCard.tsx'),
    trend:root('components/dashboard/SalesTrendChart.tsx'),
    cashflow:root('components/dashboard/CashflowChart.tsx'),
    sales:root('components/dashboard/RecentSalesTable.tsx'),
    dues:root('components/dashboard/DuesList.tsx')
  };
  const patched=patchLiveDashboardSource(original);
  assert.ok(patched.dashboard.includes('useLiveDashboardData()'));
  assert.ok(patched.dashboard.includes('liveValue={live.values[w.id]'));
  assert.ok(patched.dashboard.includes('<CustomizeDialog'),'Source layout controls must remain');
  assert.ok(patched.dashboard.includes('<WidgetFrame'),'Source metric/panel composition must remain');
  assert.ok(patched.metric.includes('liveValue ??'), 'No fixture-backed amount can reach a metric card');
  for(const [key,required] of [['trend','data={rows}'],['cashflow','data={rows}'],
    ['sales','(sales ?? recentSales).map'],['dues','(dues ?? duesToCollect).map']]){
    assert.ok(patched[key].includes(required), key+' source component lost real-data seam');
  }
  for(const x of ['SalesTrendChart data={[]}','CashflowChart data={[]}',
    'RecentSalesTable sales={[]}','DuesList dues={[]}'])
    assert.ok(patched.dashboard.includes(x),'Unsupported source panel must not use sample records: '+x);
  assert.throws(()=>patchLiveDashboardSource({...original,dashboard:'unexpected'}),/Dashboard upstream contract changed/);
  const hook=read('overlay/src/integration/useLiveDashboardData.ts');
  assert.ok(hook.includes('getLiveReportSummary('));
  assert.ok(hook.includes('canUseModule('));
  assert.ok(hook.includes("metric.status==='ready'"));
  assert.ok(!hook.includes('from \x27../data/dashboard\x27'));
});
