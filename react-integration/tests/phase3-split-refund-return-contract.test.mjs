import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('G2-H split refund UI only posts source-verified full invoice reversal with explicit reason',()=>{
  const api=read('overlay/src/integration/banijjApi.ts');
  const ui=read('overlay/src/integration/LiveSalesReturnsPage.tsx');
  assert.match(api,/getSplitReversalPreview/);
  assert.match(api,/postSplitReversal/);
  assert.match(api,/\/split-reversal/);
  assert.match(ui,/getSplitReversalPreview\(sale\.invoiceId\)/);
  assert.match(ui,/splitPreview\?\.eligible/);
  assert.match(ui,/postSplitReversal\(sale\.invoiceId/);
  assert.match(ui,/creditReissueCents/);
  assert.match(ui,/refundCents/);
  assert.match(ui,/amountCents/);
  assert.match(ui,/splitReason\.trim\(\)\.length<8/);
  assert.match(ui,/canUseModule\(user,'returns','add'\)/);
  assert.match(ui,/data-split-refund-review/);
  assert.match(ui,/data-split-refund-success/);
  assert.doesNotMatch(ui,/Convert Store Credit to Cash/);
});
