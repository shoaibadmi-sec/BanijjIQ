import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { readSalesProfit } from '../server/modules/reporting/live/sales-profit.ts';
import { parseLiveReportQuery } from '../server/modules/reporting/live/query.ts';

const query = (report:'sales'|'profit')=>parseLiveReportQuery(new URL(
  'http://local.test/api/reports/v2/rows?report='+report+'&from=2026-10-01&to=2026-10-30'));

function fixture() {
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  db.native.prepare(`INSERT INTO products (product_id,product_name,category,unit,current_stock)
    VALUES ('PROD-FIFO-001','Demo Copper Wire','Electrical','Pcs',0)`).run();
  db.native.prepare(`INSERT INTO stock_lots
    (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost)
    VALUES ('LOT-FIFO-001','PROD-FIFO-001','PURCHASE','BUY-001',2,0,70)`).run();
  db.native.prepare(`INSERT INTO sales
    (invoice_id,sale_date,customer_name,customer_phone,subtotal,discount,grand_total,
    paid_amount,due_amount,payment_type,payment_status,status)
    VALUES ('SALE-PROFIT-001','2026-10-15','Real Buyer','01000000122',
    240,20,220,110,110,'Partial','Partial','Completed')`).run();
  db.native.prepare(`INSERT INTO sale_items (invoice_id,product_id,product_name,quantity,unit_price,line_total)
    VALUES ('SALE-PROFIT-001','PROD-FIFO-001','Demo Copper Wire',2,120,240)`).run();
  db.native.prepare(`INSERT INTO sale_item_lots (invoice_id,product_id,lot_id,quantity,unit_cost)
    VALUES ('SALE-PROFIT-001','PROD-FIFO-001','LOT-FIFO-001',2,70)`).run();
  db.native.prepare(`INSERT INTO expenses
    (expense_id,expense_date,category_id,category_name,amount,payment_method)
    VALUES ('EXP-REPORT-001','2026-10-18','CAT-OPERATING','Operating costs',20,'Cash')`).run();
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('CB-EXP-REPORT-001','2026-10-18','Expense','EXP-REPORT-001',20,0)").run();
  return db;
}
function metric(result:Awaited<ReturnType<typeof readSalesProfit>>,key:string) {
  const record=result.metrics.find(x=>x.key===key);
  assert.ok(record,'metric '+key+' should exist');return record;
}

test('FIFO sale, original discount and exact mixed return lot reversal reconcile without double-discount',async()=>{
 const db=fixture();
 try {
  db.native.prepare(`INSERT INTO sales_returns
    (return_id,return_date,invoice_id,refund_method,total_return_amount,reason)
    VALUES ('RETURN-001','2026-10-19','SALE-PROFIT-001','Cash',110,'One item returned')`).run();
  db.native.prepare(`INSERT INTO sales_return_items
    (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total)
    VALUES ('RETURN-001','SALE-PROFIT-001','PROD-FIFO-001','Demo Copper Wire',1,110,110)`).run();
  db.native.prepare(`INSERT INTO sales_return_item_lots
    (return_id,invoice_id,product_id,lot_id,quantity)
    VALUES ('RETURN-001','SALE-PROFIT-001','PROD-FIFO-001','LOT-FIFO-001',1)`).run();
  const result=await readSalesProfit(db,query('profit'));
  assert.equal(result.coverage.status,'ready',result.coverage.reason);
  for(const [key,expected] of Object.entries({
    grossSales:22000,discounts:2000,returns:11000,netSales:11000,
    fifoCogs:7000,grossProfit:4000,operatingExpenses:2000,netProfit:2000
  })) assert.equal(metric(result,key).valueMinor,expected,key);
  assert.deepEqual(result.rows.map(x=>x.sourceId),['SALE-PROFIT-001']);
  assert.equal(result.rows[0].amountMinor,11000);
  assert.equal(metric(result,'netProfit').sources[0].sourceId,'SALE-PROFIT-001');
 }finally{db.close();}
});

test('missing original FIFO sale allocation yields nullable profit, never zero cost',async()=>{
 const db=fixture();
 try {
  db.native.prepare("DELETE FROM sale_item_lots WHERE invoice_id='SALE-PROFIT-001'").run();
  const report=await readSalesProfit(db,query('profit'));
  assert.equal(report.coverage.status,'incomplete');
  assert.equal(metric(report,'netSales').valueMinor,22000);
  assert.equal(metric(report,'fifoCogs').valueMinor,null);
  assert.equal(metric(report,'grossProfit').valueMinor,null);
  assert.equal(metric(report,'netProfit').valueMinor,null);
  assert.equal(metric(report,'netProfit').status,'incomplete');
 }finally{db.close();}
});

test('legacy return missing immutable FIFO lot allocation withholds profit even when sold FIFO exists',async()=>{
 const db=fixture();
 try {
  db.native.prepare(`INSERT INTO sales_returns
    (return_id,return_date,invoice_id,refund_method,total_return_amount,reason)
    VALUES ('RETURN-LEGACY','2026-10-19','SALE-PROFIT-001','Cash',110,'Legacy return')`).run();
  db.native.prepare(`INSERT INTO sales_return_items
    (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total)
    VALUES ('RETURN-LEGACY','SALE-PROFIT-001','PROD-FIFO-001','Demo Copper Wire',1,110,110)`).run();
  const report=await readSalesProfit(db,query('profit'));
  assert.equal(metric(report,'netSales').valueMinor,11000);
  assert.equal(metric(report,'netProfit').valueMinor,null);
  assert.equal(report.coverage.status,'incomplete');
  assert.match(report.coverage.reason,/return lot|reversal|allocation/i);
 }finally{db.close();}
});

test('empty sales period does not invent profit and expenses remain separate',async()=>{
 const db=fixture();
 try {
  const q=parseLiveReportQuery(new URL('http://local.test/api/reports/v2/rows?report=profit&from=2026-09-01&to=2026-09-30'));
  const report=await readSalesProfit(db,q);
  assert.equal(report.totalRows,0);
  assert.equal(metric(report,'netSales').valueMinor,0);
  assert.equal(metric(report,'fifoCogs').valueMinor,0);
  assert.equal(metric(report,'netProfit').valueMinor,0);
 }finally{db.close();}
});

test('customer-filtered profit does not misallocate all business operating expenses',async()=>{
 const db=fixture();
 try {
  const filtered=parseLiveReportQuery(new URL(
   'http://local.test/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-30&search=Real%20Buyer'));
  const result=await readSalesProfit(db,filtered);
  assert.equal(result.totalRows,1);
  assert.equal(result.coverage.status,'incomplete');
  assert.equal(metric(result,'netProfit').valueMinor,null);
  assert.match(result.coverage.reason,/search|expense allocation|filtered/i);
 }finally{db.close();}
});

test('unposted draft invoices never enter recorded sales or profit',async()=>{
 const db=fixture();
 try {
  db.native.prepare(`INSERT INTO sales
    (invoice_id,sale_date,customer_name,customer_phone,subtotal,discount,grand_total,payment_type,payment_status,status)
    VALUES ('SALE-DRAFT-001','2026-10-16','Unposted Draft Buyer','01000000128',
    900,0,900,'Cash','Unpaid','Draft')`).run();
  const report=await readSalesProfit(db,query('profit'));
  assert.equal(report.totalRows,1);
  assert.equal(metric(report,'grossSales').valueMinor,22000);
  assert.ok(!report.rows.some(x=>x.sourceId==='SALE-DRAFT-001'));
 }finally{db.close();}
});

test('posted FIFO sale with expense missing cash-book proof cannot certify net profit',async()=>{
 const db=fixture();
 try {
  db.native.prepare("DELETE FROM cash_book WHERE entry_id='CB-EXP-REPORT-001'").run();
  const report=await readSalesProfit(db,query('profit'));
  assert.equal(metric(report,'operatingExpenses').valueMinor,null);
  assert.equal(metric(report,'netProfit').valueMinor,null);
  assert.equal(report.coverage.status,'incomplete');
  assert.match(report.coverage.reason,/expense.*posting|money.book|expense.*source/i);
 } finally{db.close();}
});

test('two returns cannot conceal mismatched FIFO restoration by balancing invoice-level totals',async()=>{
 const db=fixture();
 try{
  db.native.prepare(`INSERT INTO sales_returns
    (return_id,return_date,invoice_id,refund_method,total_return_amount,reason)
    VALUES ('RETURN-OVERALLOC','2026-10-19','SALE-PROFIT-001','Cash',110,'First unit'),
           ('RETURN-MISSING','2026-10-20','SALE-PROFIT-001','Store Credit',110,'Second unit')`).run();
  db.native.prepare(`INSERT INTO sales_return_items
    (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total)
    VALUES ('RETURN-OVERALLOC','SALE-PROFIT-001','PROD-FIFO-001','Demo Copper Wire',1,110,110),
           ('RETURN-MISSING','SALE-PROFIT-001','PROD-FIFO-001','Demo Copper Wire',1,110,110)`).run();
  // Global restored quantity (2) matches returned quantity (2), but only the
  // first return owns FIFO evidence. The second is missing its own restoration.
  db.native.prepare(`INSERT INTO sales_return_item_lots
    (return_id,invoice_id,product_id,lot_id,quantity)
    VALUES ('RETURN-OVERALLOC','SALE-PROFIT-001','PROD-FIFO-001','LOT-FIFO-001',2)`).run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const report=await readSalesProfit(db,query('profit'));
  assert.equal(report.coverage.status,'incomplete','each return requires matching original FIFO allocation');
  assert.match(report.coverage.reason,/each return|return.*lot|return.*allocation/i);
  assert.equal(metric(report,'returns').valueMinor,22000,'actual cash and store-credit refunds are not discounted twice');
  assert.equal(metric(report,'fifoCogs').valueMinor,null,'ambiguous cost reversals cannot become certified profit');
  assert.equal(metric(report,'grossProfit').valueMinor,null);
  assert.equal(metric(report,'netProfit').valueMinor,null);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,
    'profit reconciliation must not write to accounting tables');
 }finally{db.close();}
});
