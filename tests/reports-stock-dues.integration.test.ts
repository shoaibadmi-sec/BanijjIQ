import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { readStockDues } from '../server/modules/reporting/live/stock-dues.ts';
import { parseLiveReportQuery } from '../server/modules/reporting/live/query.ts';

const query=(report:'stock'|'receivables'|'payables',search='')=>
  parseLiveReportQuery(new URL('https://test.local/api/reports/v2/rows?report='+report+
  '&from=2026-10-01&to=2026-10-30&search='+encodeURIComponent(search)));
function fixture(){
 const db=new SqliteDatabase(':memory:');
 runMigrations(db.native,resolve('migrations'));
 return db;
}
function metric(page:Awaited<ReturnType<typeof readStockDues>>,key:string){
 const m=page.metrics.find(x=>x.key===key);
 assert.ok(m,'missing metric '+key);return m;
}
test('two original-cost FIFO lots produce exact stock value with source IDs, no retail pricing',async()=>{
 const db=fixture();
 try{
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,selling_price) VALUES ('STK-1','Steel Wire','Hardware','Pcs',5,999)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('LOT-A','STK-1','PURCHASE',4,2,70),('LOT-B','STK-1','PURCHASE',6,3,90)").run();
  const before=db.native.prepare('SELECT total_changes() AS n').get() as {n:number};
  const page=await readStockDues(db,query('stock'));
  assert.equal(page.totalRows,1);
  assert.equal(page.rows[0].sourceId,'STK-1');
  assert.equal(page.rows[0].amountMinor,41000);
  assert.equal(page.coverage.status,'needs-review','current snapshot cannot be claimed historical 2026-10-30');
  assert.equal(metric(page,'inventoryValue').valueMinor,41000);
  assert.deepEqual(metric(page,'inventoryValue').sources.map(x=>x.sourceId),['LOT-A','LOT-B']);
  assert.equal((db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n,before.n);
 }finally{db.close();}
});
test('stock mismatch, negative stock and missing lot cost withhold valuation, including inactive stock',async()=>{
 const db=fixture();
 try{
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,status) VALUES ('S-1','Good','Hardware','Pcs',1,'Active'),('S-2','Mismatch','Hardware','Pcs',5,'Active'),('S-3','Inactive stocked','Hardware','Pcs',2,'Inactive'),('S-4','Negative','Hardware','Pcs',-1,'Active')").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('LA','S-1','PURCHASE',1,1,20),('LB','S-2','PURCHASE',2,2,30),('LC','S-3','PURCHASE',2,2,40),('LD','S-4','OVERSOLD',0,-1,10)").run();
  const page=await readStockDues(db,query('stock'));
  assert.equal(page.totalRows,4);
  assert.equal(page.coverage.status,'incomplete');
  assert.equal(metric(page,'inventoryValue').valueMinor,null);
  assert.equal(page.rows.find(r=>r.sourceId==='S-1')?.amountMinor,2000);
  assert.equal(page.rows.find(r=>r.sourceId==='S-2')?.amountMinor,null);
  assert.equal(page.rows.find(r=>r.sourceId==='S-3')?.amountMinor,8000);
  assert.equal(page.rows.find(r=>r.sourceId==='S-4')?.amountMinor,null);
 }finally{db.close();}
});
test('customer balances reconcile by durable customer ID, never by duplicate names',async()=>{
 const db=fixture();
 try{
  db.native.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due) VALUES ('C1','Same Name','01000000101',125),('C2','Same Name','01000000102',50),('C3','Zero Due','01000000103',0)").run();
  db.native.prepare("INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,debit,credit,balance) VALUES ('CL1','2026-10-20','C1','Same Name','Opening Balance',150,25,125),('CL2','2026-10-21','C2','Same Name','Opening Balance',50,0,50)").run();
  const page=await readStockDues(db,query('receivables'));
  assert.equal(page.totalRows,3);
  assert.equal(page.rows.find(x=>x.sourceId==='C1')?.amountMinor,12500);
  assert.equal(page.rows.find(x=>x.sourceId==='C2')?.amountMinor,5000);
  assert.equal(metric(page,'receivablesBalance').valueMinor,17500);
  assert.equal(page.coverage.status,'needs-review','current dues are not verified invoice aging');
  assert.equal(metric(page,'aging0to30').valueMinor,null);
  assert.equal(metric(page,'aging31to60').valueMinor,null);
  assert.equal(metric(page,'aging61to90').valueMinor,null);
  assert.equal(metric(page,'agingOver90').valueMinor,null);
 }finally{db.close();}
});
test('supplier master/ledger disagreement withholds overall payables and flags only affected supplier',async()=>{
 const db=fixture();
 try{
  db.native.prepare("INSERT INTO suppliers(supplier_id,supplier_name,current_due) VALUES ('SUP-1','Identical',80),('SUP-2','Identical',120)").run();
  db.native.prepare("INSERT INTO supplier_ledger(ledger_id,date,supplier_id,supplier_name,type,debit,credit,balance) VALUES ('SL-1','2026-10-25','SUP-1','Identical','Purchase',80,0,80),('SL-2','2026-10-25','SUP-2','Identical','Purchase',100,0,100)").run();
  const page=await readStockDues(db,query('payables'));
  assert.equal(page.totalRows,2);
  assert.equal(page.rows.find(x=>x.sourceId==='SUP-1')?.amountMinor,8000);
  assert.equal(page.rows.find(x=>x.sourceId==='SUP-2')?.amountMinor,null);
  assert.equal(metric(page,'payablesBalance').valueMinor,null);
  assert.equal(page.coverage.status,'incomplete');
  assert.match(page.coverage.reason,/ledger/i);
 }finally{db.close();}
});
test('non-zero master balance without ledger proof stays unavailable; zero is not fabricated aging',async()=>{
 const db=fixture();
 try{
  db.native.prepare("INSERT INTO suppliers(supplier_id,supplier_name,current_due) VALUES ('SUP-EMPTY','No history',60)").run();
  const result=await readStockDues(db,query('payables'));
  assert.equal(result.rows[0].amountMinor,null);
  assert.equal(metric(result,'payablesBalance').valueMinor,null);
  assert.equal(metric(result,'aging0to30').valueMinor,null);
 }finally{db.close();}
});

test('search-filtered stock rows do not report whole-business inventory as selected-product total',async()=>{
 const db=fixture();
 try{
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('SF-1','One Bolt','Hardware','Pcs',1),('SF-2','Another Bolt','Hardware','Pcs',1)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('SL-ONE','SF-1','PURCHASE',1,1,20),('SL-TWO','SF-2','PURCHASE',1,1,30)").run();
  const filtered=await readStockDues(db,query('stock','One'));
  assert.equal(filtered.totalRows,1);
  assert.equal(filtered.rows[0].amountMinor,2000);
  assert.equal(metric(filtered,'inventoryValue').valueMinor,null,'a selected product cannot show full-business stock value');
  assert.match(metric(filtered,'inventoryValue').reason,/filter|search/i);
 }finally{db.close();}
});
