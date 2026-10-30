import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStockAlerts } from '../server/modules/products/stock-alerts.service.ts';

test('Phase 7F expiry source: unassigned tracked stock is needs-review, never silently healthy', () => {
  const product={productId:'EXP-P',productName:'Expiry Tracked Product',
    currentStock:5,minimumStock:0,trackExpiry:1};
  const lot={productId:'EXP-P',lotId:'LOT-P',originalQuantity:5,remainingQuantity:5};
  const noBatches=evaluateStockAlerts([product],[lot],[],'2026-10-30',7);
  assert.deepEqual(noBatches.map(a=>a.kind),['needs-review'],
    'a tracked product with physical inventory and zero expiry batches has unverified dates');
  const partlyAssigned=evaluateStockAlerts([product],
    [{...lot,trackingRequiredQuantity:3,trackingStatus:'Pending'}],
    [{productId:'EXP-P',lotId:'LOT-P',expiryBatchId:'EXP-A',expiryDate:'2026-11-01',remainingQuantity:2}],
    '2026-10-30',7);
  assert.deepEqual(partlyAssigned.map(a=>a.kind),['needs-review'],
    'pending 3 units must not be treated as a complete expiry snapshot');
  assert.match(partlyAssigned[0].reason||'',/tracking|expiry|pending/i);
});
test('Phase 7F expiry source: fully assigned verified quantities still produce exact expiry notices', () => {
  const product={productId:'EXP-P',productName:'Expiry Tracked Product',currentStock:3,
    minimumStock:0,trackExpiry:1};
  const lot={productId:'EXP-P',lotId:'LOT-P',originalQuantity:3,remainingQuantity:3,
    trackingRequiredQuantity:0,trackingStatus:'Ready'};
  const batches=[
    {productId:'EXP-P',lotId:'LOT-P',expiryBatchId:'EXP-A',expiryDate:'2026-10-29',remainingQuantity:1},
    {productId:'EXP-P',lotId:'LOT-P',expiryBatchId:'EXP-B',expiryDate:'2026-11-02',remainingQuantity:2},
  ];
  assert.deepEqual(evaluateStockAlerts([product],[lot],batches,'2026-10-30',7).map(a=>a.kind),
    ['expired','expiring']);
});
