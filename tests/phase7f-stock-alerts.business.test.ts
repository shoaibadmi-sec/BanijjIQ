import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStockAlerts } from '../server/modules/products/stock-alerts.service.ts';

const product=(stock:number,min:number,trackExpiry=0)=>({
  productId:'P-1',productName:'Cable',currentStock:stock,minimumStock:min,trackExpiry
});
const lot=(original:number,remaining:number)=>({lotId:'L-1',productId:'P-1',originalQuantity:original,remainingQuantity:remaining});
const batch=(id:string,date:string,quantity:number)=>({
  expiryBatchId:id,productId:'P-1',lotId:'L-1',expiryDate:date,remainingQuantity:quantity
});
test('Phase 7F business: 4-decimal stock, equal threshold and FIFO source reconciliation',()=>{
  const alert=evaluateStockAlerts([product(2,2)],[lot(1.125,1.125),{...lot(1,0.875),lotId:'L-2'}],[],'2026-10-30',30);
  assert.equal(alert.length,1);assert.equal(alert[0].kind,'low-stock');assert.equal(alert[0].shortfallToMinimum,0);
  assert.deepEqual(evaluateStockAlerts([product(2.0001,2)],[lot(2.0001,2.0001)],[],'2026-10-30',30),[]);
  for(const [p,l] of [
    [product(2.00001,3),[lot(2,2)]],
    [product(2,3),[lot(1,2)]],
    [product(2,3),[lot(2,1)]],
    [product(Number.POSITIVE_INFINITY,3),[lot(3,3)]],
  ] as const){
    const result=evaluateStockAlerts([p],l,[],'2026-10-30',30);
    assert.equal(result.length,1);assert.equal(result[0].kind,'needs-review');
    assert.equal(result[0].shortfallToMinimum,undefined,'unreconciled source cannot issue purchase advice');
  }
});
test('Phase 7F business: UTC expiry boundary, unassigned expiry and FIFO batch over-allocation fail closed',()=>{
  const p=product(3,0,1),l=lot(3,3);
  const valid=[batch('B-1','2026-11-06',1),batch('B-2','2026-11-07',1),batch('B-3','2026-10-29',1)];
  const alerts=evaluateStockAlerts([p],[l],valid,'2026-10-30',7);
  assert.deepEqual(alerts.map(x=>x.kind),['expired','expiring']);
  assert.deepEqual(alerts.map(x=>x.expiryBatchId),['B-3','B-1']);
  const overlapping=evaluateStockAlerts([p],[l],[batch('B-1','2026-10-29',2),batch('B-2','2026-11-02',2)],'2026-10-30',7);
  assert.equal(overlapping.length,1);assert.equal(overlapping[0].kind,'needs-review');
  const orphan=evaluateStockAlerts([p],[l],[{...valid[0],lotId:'NO-LOT'}],'2026-10-30',7);
  assert.equal(orphan[0].kind,'needs-review');
  const badDate=evaluateStockAlerts([p],[l],[batch('B-1','2026-02-30',1)],'2026-10-30',7);
  assert.equal(badDate[0].kind,'needs-review');
});
