import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchLiveProductSettings} from '../../scripts/preview/patch-live-product-settings.mjs';
import {patchLiveProducts} from '../../scripts/preview/patch-live-products.mjs';

test('7H3C reuse original ProductSettings tables/tabs/actions markup with no demo store or local fake writes',()=>{
 const source=readFileSync(new URL('../../apps/hisabiq-web/src/components/products/ProductSettings.tsx',import.meta.url),'utf8');
 const compiled=patchLiveProductSettings(source);
 const actions=source.slice(source.indexOf('function SettingActions('),source.indexOf('export function ProductSettings()'));
 assert.ok(actions.length>1000&&compiled.includes(actions),'source-exact action popup and original styling');
 const headers=[...source.matchAll(/<TableHeader>[\s\S]*?<\/TableHeader>/g)].map(match=>match[0]);
 assert.equal(headers.length,3);
 for(const tableHeader of headers)assert.ok(compiled.includes(tableHeader),'original Categories/Units/Brands columns unchanged');
 for(const key of ['const tabs: Array<[SettingsTab','<MotionTabList','<TableBody>','<SettingActions','{tab === \'defaults\' &&','<Button size="sm" onClick={addNamed}'])
  assert.ok(compiled.includes(key),'original settings structure remains: '+key);
 for(const forbidden of ['initialCategories','initialUnits','initialBrands','availableProductCategories','createPreviewProductCategory','createPreviewProductBrand','createPreviewProductUnit','cat-preview-','br-preview-'])
  assert.ok(!compiled.includes(forbidden),'no static demo data or fake writes: '+forbidden);
 assert.match(compiled,/loadProductSettingsLookups\(/);
 assert.match(compiled,/createProductSettingsLookup\(/);
 assert.match(compiled,/setProductSettingsLookupStatus\(/);
 assert.match(compiled,/deleteProductSettingsLookup\(/);
 assert.match(compiled,/toast\.error/);
});

test('7H3C Products re-enables original Settings tab + source JSX without replacement layout',()=>{
 const source=readFileSync(new URL('../../apps/hisabiq-web/src/pages/Products.tsx',import.meta.url),'utf8');
 const compiled=patchLiveProducts(source);
 const start=source.indexOf("      {view === 'settings' && (");
 const end=source.indexOf('      <ImportWizard target=',start);
 assert.ok(start>0&&end>start);
 assert.ok(compiled.includes(source.slice(start,end)),'full source-exact ProductSettings JSX');
 assert.match(compiled,/import \{ ProductSettings \} from '\.\.\/components\/products\/ProductSettings';/);
 assert.doesNotMatch(compiled,/disabled=\{id!=='list'&&id!=='history'&&id!=='lots'\}/);
 assert.doesNotMatch(compiled,/Awaiting real API integration/);
});
