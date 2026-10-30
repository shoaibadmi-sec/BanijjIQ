import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchLiveProducts } from '../../scripts/preview/patch-live-products.mjs';

test('Phase 7F2: source-exact HisabIQ Products JSX gains live alert panel without losing existing layout',()=>{
  const source=readFileSync(new URL('../../apps/hisabiq-web/src/pages/Products.tsx',import.meta.url),'utf8');
  const result=patchLiveProducts(source);
  assert.match(result,/import \{ LiveStockAlerts \} from '\.\.\/integration\/products\/LiveStockAlerts';/);
  assert.match(result,/<LiveStockAlerts enabled=\{permitted\} refreshKey=\{items\}/);
  assert.match(result,/onSelectProduct=\{name=>\{setQuery\(name\);setStockFilter\('all'\);setCategory\('All'\);\}\}/);
  assert.match(result,/<MotionTabList className=/);
  assert.match(result,/<ProductColumnPicker visible=\{visibleColumns\}/);
  assert.match(result,/<TableRow key=\{p\.id\} className="text-\[13px\]">/);
  assert.doesNotMatch(result,/availableStockLots\(/);
});
