import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchLiveProducts } from '../../scripts/preview/patch-live-products.mjs';

test('Phase 7F2: pinned HisabIQ Products retains original summary, filters, table and tabs with no extra stock alert panel',()=>{
  const source=readFileSync(new URL('../../apps/hisabiq-web/src/pages/Products.tsx',import.meta.url),'utf8');
  const result=patchLiveProducts(source);
  assert.doesNotMatch(result,/LiveStockAlerts|Live stock alerts|Stock alerts · স্টক সতর্কতা/);
  assert.match(result,/<MotionTabList className=/);
  assert.match(result,/<ProductColumnPicker visible=\{visibleColumns\}/);
  assert.match(result,/<TableRow key=\{p\.id\} className="text-\[13px\]">/);
  assert.match(result,/label:'Low stock'/);
  assert.match(result,/label:'Out of stock'/);
  assert.match(result,/onClick=\{\(\) => setCategory\(c\)\}/);
  const summaryStart=result.indexOf('      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">');
  const tableStart=result.indexOf('      <div className="rounded-xl border border-border bg-card shadow-card">',summaryStart);
  assert.ok(summaryStart>0&&tableStart>summaryStart,'original summary flows directly into original table');
  assert.doesNotMatch(result.slice(summaryStart,tableStart),/<LiveStockAlerts|Live stock alerts|Stock alerts/);
  assert.doesNotMatch(result,/availableStockLots\(/);
});
