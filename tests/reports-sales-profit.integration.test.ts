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

test('cross-invoice return lines and lots cannot certify another invoice refund',async()=>{
 const db=fixture();
 try {
  db.native.prepare(`INSERT INTO stock_lots
    (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost)
    VALUES ('LOT-FIFO-B','PROD-FIFO-001','PURCHASE','BUY-B',1,0,70)`).run();
  db.native.prepare(`INSERT INTO sales
    (invoice_id,sale_date,customer_name,customer_phone,subtotal,discount,grand_total,
     payment_type,payment_status,status)
    VALUES ('SALE-PROFIT-B','2026-10-16','Second Buyer','01000000123',120,0,120,
    'Cash','Paid','Completed')`).run();
  db.native.prepare(`INSERT INTO sale_items
    (invoice_id,product_id,product_name,quantity,unit_price,line_total)
    VALUES ('SALE-PROFIT-B','PROD-FIFO-001','Demo Copper Wire',1,120,120)`).run();
  db.native.prepare(`INSERT INTO sale_item_lots
    (invoice_id,product_id,lot_id,quantity,unit_cost)
    VALUES ('SALE-PROFIT-B','PROD-FIFO-001','LOT-FIFO-B',1,70)`).run();
  // The refund header belongs to A, but BOTH child records are falsely
  // attributed to B. Document totals and FIFO quantities still balance.
  db.native.prepare(`INSERT INTO sales_returns
    (return_id,return_date,invoice_id,refund_method,total_return_amount,reason)
    VALUES ('RETURN-CROSS-INVOICE','2026-10-19','SALE-PROFIT-001','Cash',110,'Cross-invoice mismatch')`).run();
  db.native.prepare(`INSERT INTO sales_return_items
    (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total)
    VALUES ('RETURN-CROSS-INVOICE','SALE-PROFIT-B','PROD-FIFO-001','Demo Copper Wire',1,110,110)`).run();
  db.native.prepare(`INSERT INTO sales_return_item_lots
    (return_id,invoice_id,product_id,lot_id,quantity)
    VALUES ('RETURN-CROSS-INVOICE','SALE-PROFIT-B','PROD-FIFO-001','LOT-FIFO-B',1)`).run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const result=await readSalesProfit(db,query('profit'));
  assert.equal(result.coverage.status,'incomplete',
    'return child invoice IDs must match their actual refund document');
  assert.match(result.coverage.reason,/return.*invoice|invoice.*return/i);
  assert.equal(metric(result,'returns').valueMinor,11000);
  assert.equal(metric(result,'fifoCogs').valueMinor,null);
  assert.equal(metric(result,'grossProfit').valueMinor,null);
  assert.equal(metric(result,'netProfit').valueMinor,null);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,
    'source reconciliation must not mutate recorded transactions');
 }finally{db.close();}
});

test('FIFO lot belonging to a different product cannot certify sale profitability',async()=>{
 const db=fixture();
 try {
  db.native.prepare(`INSERT INTO products (product_id,product_name,category,unit,current_stock)
    VALUES ('PROD-OTHER','Unrelated Product','Hardware','Pcs',0)`).run();
  // The sale allocation still claims PROD-FIFO-001, but its underlying stock
  // lot belongs to a different SKU. The existing quantity and cost still balance.
  db.native.prepare("UPDATE stock_lots SET product_id='PROD-OTHER' WHERE lot_id='LOT-FIFO-001'").run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const result=await readSalesProfit(db,query('profit'));
  assert.equal(result.coverage.status,'incomplete','source lot must belong to the sold product');
  assert.match(result.coverage.reason,/lot.*product|product.*lot|FIFO.*product/i);
  assert.equal(metric(result,'netSales').valueMinor,22000);
  assert.equal(metric(result,'fifoCogs').valueMinor,null);
  assert.equal(metric(result,'grossProfit').valueMinor,null);
  assert.equal(metric(result,'netProfit').valueMinor,null);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,
    'invalid FIFO source detection must not modify stock or finance');
 }finally{db.close();}
});


test('two return documents cannot restore the same original FIFO lot twice',async()=>{
 const db=fixture();
 try {
  // Original invoice sold one unit from each of two separate FIFO lots.
  db.native.prepare("UPDATE stock_lots SET original_quantity=1 WHERE lot_id='LOT-FIFO-001'").run();
  db.native.prepare("UPDATE sale_item_lots SET quantity=1 WHERE lot_id='LOT-FIFO-001'").run();
  db.native.prepare(`INSERT INTO stock_lots
    (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost)
    VALUES ('LOT-FIFO-002','PROD-FIFO-001','PURCHASE','BUY-002',1,0,70)`).run();
  db.native.prepare(`INSERT INTO sale_item_lots (invoice_id,product_id,lot_id,quantity,unit_cost)
    VALUES ('SALE-PROFIT-001','PROD-FIFO-001','LOT-FIFO-002',1,70)`).run();
  db.native.prepare(`INSERT INTO sales_returns
    (return_id,return_date,invoice_id,refund_method,total_return_amount,reason)
    VALUES ('RETURN-LOT-1','2026-10-19','SALE-PROFIT-001','Cash',110,'First unit'),
           ('RETURN-LOT-2','2026-10-20','SALE-PROFIT-001','Cash',110,'Second unit')`).run();
  db.native.prepare(`INSERT INTO sales_return_items
    (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total)
    VALUES ('RETURN-LOT-1','SALE-PROFIT-001','PROD-FIFO-001','Demo Copper Wire',1,110,110),
           ('RETURN-LOT-2','SALE-PROFIT-001','PROD-FIFO-001','Demo Copper Wire',1,110,110)`).run();
  // Simulate corrupted historical data imported before migration 0035's
  // posting-time capacity trigger existed. Live inserts remain protected.
  db.native.exec('DROP TRIGGER trg_mixed_return_lot_capacity');
  // Each document and invoice-wide quantity balances, but one original lot
  // is restored twice. Read-only reports must audit historical evidence.
  db.native.prepare(`INSERT INTO sales_return_item_lots
    (return_id,invoice_id,product_id,lot_id,quantity)
    VALUES ('RETURN-LOT-1','SALE-PROFIT-001','PROD-FIFO-001','LOT-FIFO-001',1),
           ('RETURN-LOT-2','SALE-PROFIT-001','PROD-FIFO-001','LOT-FIFO-001',1)`).run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const report=await readSalesProfit(db,query('profit'));
  assert.equal(report.coverage.status,'incomplete','a sold FIFO lot cannot be restored more than sold');
  assert.match(report.coverage.reason,/lot.*(exceed|restore|original)|return.*lot/i);
  assert.equal(metric(report,'netSales').valueMinor,0,'actual invoice and refunds remain visible');
  for(const key of ['fifoCogs','grossProfit','netProfit'])
   assert.equal(metric(report,key).valueMinor,null,key+' must fail closed');
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,
    'read-only reports must not correct historical FIFO allocations');
 }finally{db.close();}
});


test('oversized invoice period never publishes a truncated aggregate as a complete total',async()=>{
 const db=fixture();
 try {
  // Full migrated SQLite: 5002 posted headers, greater than the
  // reporter's 5001-invoice safety sample. Historical incomplete source
  // records must not turn a truncated sample into a shop-wide BDT figure.
  const insert=db.native.prepare(`INSERT INTO sales
   (invoice_id,sale_date,customer_name,customer_phone,subtotal,discount,
    grand_total,paid_amount,due_amount,payment_type,payment_status,status)
   VALUES (?,'2026-10-25','Bulk Customer','01000000124',
           100,0,100,100,0,'Cash','Paid','Completed')`);
  db.native.transaction(()=>{
   for(let i=1;i<=5001;i++) insert.run('SALE-OVER-CAP-'+String(i).padStart(5,'0'));
  })();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const result=await readSalesProfit(db,query('profit'));
  assert.equal(result.totalRows,5002);
  assert.equal(result.coverage.status,'incomplete');
  assert.match(result.coverage.reason,/5,000|split.*date.*range/i);
  for(const key of ['grossSales','discounts','returns','netSales','fifoCogs','grossProfit','netProfit']) {
   assert.equal(metric(result,key).valueMinor,null,key+' cannot report a sample-only period amount');
   assert.notEqual(metric(result,key).status,'ready',key+' must not be certified');
  }
  // Individual source rows can still show their original recorded values.
  assert.ok(result.rows.length>0);
  assert.equal(result.rows[0].amountMinor,10000);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,
   'reporting a large period must not modify D1 accounting');
 } finally { db.close(); }
});


test('orphan cash-book expense posting blocks otherwise reconciled FIFO net profit',async()=>{
 const db=fixture();try {
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('C-GHOST-PROFIT','2026-10-20','Expense','EXP-GHOST-PROFIT',15,0)").run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const result=await readSalesProfit(db,query('profit'));
  assert.equal(metric(result,'netSales').valueMinor,22000,
    'recorded invoice amounts remain visible');
  assert.equal(result.coverage.status,'incomplete',
    'missing expense source must stop certification of derived net profit');
  assert.equal(metric(result,'operatingExpenses').valueMinor,null);
  assert.equal(metric(result,'netProfit').valueMinor,null);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before);
 }finally{db.close();}
});
