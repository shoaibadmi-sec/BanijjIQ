import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchLiveProducts } from '../../scripts/preview/patch-live-products.mjs';

test('7H1 original Stock history tab is enabled and retains byte-exact HisabIQ_UI JSX',()=>{
  const source=readFileSync(new URL('../../apps/hisabiq-web/src/pages/Products.tsx',import.meta.url),'utf8');
  const compiled=patchLiveProducts(source);
  const start=source.indexOf("      {view === 'history' && (");
  const end=source.indexOf("      {view === 'settings' && (",start);
  assert.ok(start>0&&end>start,'pinned original contains stock-history panel');
  const original=source.slice(start,end);
  assert.ok(compiled.includes(original),'reuse the exact original StockHistoryView JSX and props, no new UI');
  assert.match(compiled,/import \{ StockHistoryView \} from '\.\.\/components\/products\/ProductInventoryViews';/);
  assert.match(compiled,/loadInventoryHistory\(/,'load all real history from one authorized API');
  assert.doesNotMatch(compiled,/disabled=\{id!=='list'\}/,'history tab must be selectable');
  assert.doesNotMatch(compiled,/availableStockMovements\(|salesInvoices|setMovements\(availableStockMovements/);
  assert.doesNotMatch(compiled,/LiveStockAlerts|Live stock alerts/);
});
