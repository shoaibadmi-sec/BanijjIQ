import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchLiveProducts } from '../../scripts/preview/patch-live-products.mjs';

test('7H2 reuses pinned HisabIQ StockLotsView JSX and original stock adjustment dialog without redesign',()=>{
  const source=readFileSync(new URL('../../apps/hisabiq-web/src/pages/Products.tsx',import.meta.url),'utf8');
  const compiled=patchLiveProducts(source);
  const begin=source.indexOf("      {view === 'lots' && (");
  const end=source.indexOf("      {view === 'history' && (",begin);
  assert.ok(begin>0&&end>begin);
  assert.ok(compiled.includes(source.slice(begin,end)), 'source-exact original stock lots table and controls');
  assert.match(compiled,/import \{ StockLotsView \} from '\.\.\/components\/products\/ProductInventoryViews';/);
  assert.match(compiled,/import \{ StockAdjustmentDialog \} from '\.\.\/components\/products\/ProductInventoryDialogs';/);
  assert.match(compiled,/loadInventoryLots\(/);
  assert.match(compiled,/<StockAdjustmentDialog/);
  assert.doesNotMatch(compiled,/disabled=\{id!=='list'&&id!=='history'\}/);
  assert.doesNotMatch(compiled,/availableStockLots\(|availableStockMovements\(|upsertProductPreview/);
  assert.doesNotMatch(compiled,/LiveStockAlerts/);
});
