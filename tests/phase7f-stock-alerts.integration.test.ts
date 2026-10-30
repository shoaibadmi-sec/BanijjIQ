import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

type Alert = {kind:string;productId:string;lotId?:string;expiryBatchId?:string;shortfallToMinimum?:number;sourceStatus?:string};
test('Phase 7F stock alerts: authenticated, source-checked, exact thresholds, expired and near-expiry, read-only', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    let token = '';
    async function api(path:string, method='GET') {
      const response = await handleApiRequest(new Request('https://local.test' + path, {method,
        headers: token ? {authorization:'Bearer '+token} : {}}), db);
      return {status:response.status, ...await response.json() as Record<string,any>};
    }
    assert.equal((await api('/api/products/stock-alerts?asOf=2026-10-30&days=7')).status,401);
    const created=await handleApiRequest(new Request('https://local.test/api/setup/admin',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({fullName:'Stock Alerts Test',phone:'01000007787',password:'LocalTestPassword!2026'})
    }),db);
    const setup=await created.json() as any;assert.equal(created.status,200,JSON.stringify(setup));token=setup.token;
    const addProduct=db.native.prepare('INSERT INTO products(product_id,product_name,category,unit,current_stock,minimum_stock,status,track_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const addLot=db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES (?, ?, 'PURCHASE', ?, ?, 25)");
    addProduct.run('A','Empty','Hardware','Pcs',0,3,'Active',0);
    addProduct.run('B','Low','Hardware','Pcs',2,5,'Active',0);addLot.run('B-LOT','B',2,2);
    addProduct.run('C','Healthy','Hardware','Pcs',8,2,'Active',0);addLot.run('C-LOT','C',8,8);
    addProduct.run('D','Tracked','Hardware','Pcs',4,0,'Active',1);addLot.run('D-LOT','D',4,4);
    addProduct.run('E','Broken Source','Hardware','Pcs',7,8,'Active',0);addLot.run('E-LOT','E',4,4);
    addProduct.run('F','Inactive','Hardware','Pcs',0,4,'Inactive',0);
    const batch=db.native.prepare("INSERT INTO stock_expiry_batches(expiry_batch_id,lot_id,product_id,batch_no,expiry_date,original_quantity,remaining_quantity) VALUES (?, 'D-LOT','D','B1',?,?,?)");
    batch.run('EXP-OLD','2026-10-29',1,1);
    batch.run('EXP-SOON','2026-11-03',2,2);
    batch.run('EXP-LATER','2026-12-01',1,1);
    const before=(db.native.prepare('SELECT total_changes() n').get() as any).n;
    const result=await api('/api/products/stock-alerts?asOf=2026-10-30&days=7');
    assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(result.asOf,'2026-10-30');
    assert.deepEqual(result.counts,{outOfStock:1,lowStock:1,expired:1,expiring:1,needsReview:1});
    const alerts=result.alerts as Alert[];
    assert.equal(result.totalAlerts,5);
    assert.equal(alerts.find(a=>a.productId==='A')?.kind,'out-of-stock');
    assert.equal(alerts.find(a=>a.productId==='B')?.shortfallToMinimum,3);
    assert.equal(alerts.find(a=>a.productId==='D'&&a.expiryBatchId==='EXP-OLD')?.kind,'expired');
    assert.equal(alerts.find(a=>a.productId==='D'&&a.expiryBatchId==='EXP-SOON')?.kind,'expiring');
    assert.equal(alerts.find(a=>a.productId==='E')?.kind,'needs-review');
    assert.equal(alerts.some(a=>a.productId==='C'||a.productId==='F'||a.expiryBatchId==='EXP-LATER'),false);
    assert.equal(result.page,1);assert.equal(result.pageSize,50);
    assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before,'alerts must not change data');
    const late=await api('/api/products/stock-alerts?asOf=2026-10-30&days=0');
    assert.equal(late.counts.expiring,0);
    assert.equal(late.counts.expired,1);
    const paged=await api('/api/products/stock-alerts?asOf=2026-10-30&days=7&page=2&pageSize=50');
    assert.equal(paged.totalAlerts,5);assert.equal(paged.page,2);assert.equal(paged.pageSize,50);assert.equal(paged.alerts.length,0);
    for(const query of ['days=-1','days=91','days=1.5','asOf=2026-02-30','asOf=bad','page=0','pageSize=10']){
      const bad=await api('/api/products/stock-alerts?'+query);
      assert.equal(bad.status,400,JSON.stringify({query,bad}));
    }
    assert.equal((await api('/api/products/stock-alerts','POST')).status,404);
  } finally {db.close();}
});
