import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {patchLiveProducts} from '../../scripts/preview/patch-live-products.mjs';

const root=new URL('../../',import.meta.url);
const read=(path)=>readFileSync(new URL(path,root),'utf8');
test('main Products route uses original source and real API controller, not temporary page',()=>{
 const prepare=read('scripts/prepare-hisabiq-react.mjs');
 assert.ok(prepare.includes("patchLiveProducts("),'generated source must be strictly patched');
 assert.ok(prepare.includes('<Route path="products" element={<Products />} />'));
 assert.ok(prepare.includes('<Route path="pos" element={<LivePos />} />'));
 assert.ok(!prepare.includes('<Route path="products" element={<LiveProducts />} />'));
});
test('build-copy patch preserves original protected JSX and has no demo business data or fake writes',()=>{
 const source=read('apps/hisabiq-web/src/pages/Products.tsx');
 const before=createHash('sha256').update(source).digest('hex');
 const patched=patchLiveProducts(source);
 assert.notEqual(source,patched);
 const baseline=JSON.parse(read('react-integration/tests/reference/products-baseline.json'));
 const preserved=['pageHeader','underlineTabs','columnPicker','stockValueHead','rowActions','search','rowDensity'];
 const generatedLines=new Set(patched.split(/\r?\n/));
 for(const name of preserved)assert.ok(generatedLines.has(baseline.hisabiq.markers[name].line),name+' must match exact source JSX');
 for(const ui of ['PageHeader','MotionTabList','ProductColumnPicker','TableHead','TableBody','Stock value','Search name, বাংলা, SKU','data-live-products'])
  assert.ok(patched.includes(ui),ui);
 for(const backend of ['useLiveProducts(permitted)','toProductView','stockValueByProduct[p.id]','onAdjustStock={adjustStock}',
  'onSetStatus={setStatus}','loadLots={loadLots}','loadHistory={loadHistory}','lookups.categories'])
  assert.ok(patched.includes(backend),backend);
 for(const dangerous of ['availableProducts(', 'availableProductCategories(', 'availableStockLots(',
  'availableStockMovements(', 'salesInvoices','upsertProductPreview','upsertBundlePreview',
  'commitProductImportPreview','setList(', 'getBundleVersion(', 'bundleInventoryValue(',
  'ImportWizard', 'StockLotDialog', 'ManageOffersDialog','productOffers as seedOffers'])
  assert.ok(!patched.includes(dangerous),'live page must not include '+dangerous);
 assert.equal(createHash('sha256').update(read('apps/hisabiq-web/src/pages/Products.tsx')).digest('hex'),before,
   'Source submodule must remain immutable');
});
test('strict build patch fails closed on modified source or missing JSX sentinels',()=>{
 const source=read('apps/hisabiq-web/src/pages/Products.tsx');
 assert.throws(()=>patchLiveProducts(source.replace('Products','ProductsNotPinned')),/source|pinned|mismatch/i);
 assert.throws(()=>patchLiveProducts(source.replace('      <PageHeader','      <UnknownHeader')),/source|pinned|mismatch/i);
});
