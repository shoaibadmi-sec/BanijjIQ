import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {parseLiveReportQuery} from '../server/modules/reporting/live/query.ts';
import {readCashExpenses} from '../server/modules/reporting/live/cash-expenses.ts';

const query=(report:'cash'|'expenses'|'finance'|'bank',search='')=>
  parseLiveReportQuery(new URL('https://local.test/api/reports/v2/rows?report='+report+
    '&from=2026-10-01&to=2026-10-30&search='+encodeURIComponent(search)));
function fixture() {
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash) VALUES ('SESSION-001','Cashier',500)").run();
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,opening_balance,current_balance) VALUES ('BA','Bank A',300,200),('BB','Bank B',50,150)").run();
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit) VALUES "+
    "('C-SALE','2026-10-16','Sale','INV-001','Cash invoice',0,200),"+
    "('C-EXP','2026-10-16','Expense','EXP-001','Operating expense',50,0),"+
    "('C-CAP','2026-10-16','Owner Investment','FIN-001','Capital',0,300)").run();
  db.native.prepare("INSERT INTO bank_transfers(transfer_id,transfer_date,from_account_id,from_account_name,to_account_id,to_account_name,amount) VALUES ('TX-001','2026-10-16','BA','Bank A','BB','Bank B',100)").run();
  db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,debit,credit) VALUES "+
    "('B-OUT','BA','2026-10-16','Transfer Out','TX-001',100,0),"+
    "('B-IN','BB','2026-10-16','Transfer In','TX-001',0,100)").run();
  db.native.prepare("INSERT INTO finance_persons(person_id,person_name,person_type) VALUES ('OWNER-1','Business Owner','Owner')").run();
  db.native.prepare("INSERT INTO finance_transactions(finance_id,date,transaction_type,person_id,person_name,payment_method,amount) "+
    "VALUES ('FIN-001','2026-10-16','Owner Investment','OWNER-1','Business Owner','Cash',300)").run();
  db.native.prepare("INSERT INTO expenses(expense_id,expense_date,category_id,category_name,amount,payment_method) "+
    "VALUES ('EXP-001','2026-10-16','OPERATING','Utilities',50,'Cash')").run();
  return db;
}
function metric(page:Awaited<ReturnType<typeof readCashExpenses>>,key:string){
  const m=page.metrics.find(x=>x.key===key);assert.ok(m,'missing '+key);return m;
}
test('cash/bank book reports receipts and payments without counting session opening or bank transfer as income',async()=>{
 const db=fixture();try {
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const cash=await readCashExpenses(db,query('cash'));
  assert.equal(metric(cash,'cashReceipts').valueMinor,50000);
  assert.equal(metric(cash,'cashPayments').valueMinor,5000);
  assert.equal(metric(cash,'cashBookBalance').valueMinor,45000);
  assert.equal(metric(cash,'bankReceipts').valueMinor,10000);
  assert.equal(metric(cash,'bankPayments').valueMinor,10000);
  assert.equal(metric(cash,'bankCurrentBalance').valueMinor,35000);
  assert.equal(metric(cash,'internalTransferVolume').valueMinor,10000,'transfer counted once, not both sides');
  assert.equal(metric(cash,'externalNetMovement').valueMinor,45000);
  assert.equal(metric(cash,'ownerCapitalIn').valueMinor,30000);
  assert.equal(metric(cash,'operatingExpenses').valueMinor,5000);
  assert.ok(!cash.metrics.some(x=>x.key==='netSales'||x.key==='netProfit'),'cash receipt is not profit');
  assert.deepEqual(cash.rows.map(x=>x.sourceId).sort(),['B-IN','B-OUT','C-CAP','C-EXP','C-SALE']);
  assert.equal(cash.coverage.status,'needs-review','cash book is not physical cash and bank is current snapshot');
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,'GET logic must not write');
 }finally{db.close();}
});
test('bank current balance drift withholds bank closing value without inventing reconciliation',async()=>{
 const db=fixture();try {
  db.native.prepare("UPDATE bank_accounts SET current_balance=275 WHERE bank_account_id='BA'").run();
  const page=await readCashExpenses(db,query('bank'));
  assert.equal(metric(page,'bankCurrentBalance').valueMinor,null);
  assert.equal(page.coverage.status,'incomplete');
  assert.match(page.coverage.reason,/bank.*balance|ledger.*balance/i);
 }finally{db.close();}
});
test('one-sided internal transfer fails closed and cannot be classified external revenue',async()=>{
 const db=fixture();try {
  db.native.prepare("DELETE FROM bank_book WHERE entry_id='B-IN'").run();
  const page=await readCashExpenses(db,query('cash'));
  assert.equal(metric(page,'internalTransferVolume').valueMinor,null);
  assert.equal(metric(page,'externalNetMovement').valueMinor,null);
  assert.equal(page.coverage.status,'incomplete');
  assert.match(page.coverage.reason,/transfer/i);
 }finally{db.close();}
});
test('expenses use active expense IDs and match actual money-posting references',async()=>{
 const db=fixture();try {
  const exp=await readCashExpenses(db,query('expenses'));
  assert.equal(exp.totalRows,1);
  assert.equal(exp.rows[0].sourceId,'EXP-001');
  assert.equal(metric(exp,'operatingExpenses').valueMinor,5000);
  assert.ok(!exp.rows.some(x=>x.sourceId==='C-CAP'));
  db.native.prepare("UPDATE cash_book SET debit=40 WHERE entry_id='C-EXP'").run();
  const mismatch=await readCashExpenses(db,query('expenses'));
  assert.equal(mismatch.coverage.status,'incomplete');
  assert.equal(metric(mismatch,'operatingExpenses').valueMinor,null);
  assert.equal(mismatch.rows[0].amountMinor,null);
 }finally{db.close();}
});
test('owner finance transaction is identifiable by source ID, not classified as sale or expense',async()=>{
 const db=fixture();try {
  const finance=await readCashExpenses(db,query('finance'));
  assert.equal(finance.totalRows,1);
  assert.equal(finance.rows[0].sourceId,'FIN-001');
  assert.equal(finance.rows[0].amountMinor,30000);
  assert.equal(metric(finance,'ownerCapitalIn').valueMinor,30000);
  assert.equal(finance.metrics.some(m=>m.key==='netSales'||m.key==='netProfit'),false);
 }finally{db.close();}
});
test('filtered expense rows cannot present the unfiltered whole-shop total as a filtered sum',async()=>{
 const db=fixture();try {
  db.native.prepare("INSERT INTO expenses(expense_id,expense_date,category_id,category_name,amount,payment_method) "+
    "VALUES ('EXP-002','2026-10-18','OTHER','Rent',70,'Cash')").run();
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('C-EXP-2','2026-10-18','Expense','EXP-002',70,0)").run();
  const page=await readCashExpenses(db,query('expenses','Utilities'));
  assert.equal(page.totalRows,1);
  assert.equal(page.rows[0].sourceId,'EXP-001');
  assert.equal(metric(page,'operatingExpenses').valueMinor,null);
  assert.match(metric(page,'operatingExpenses').reason,/search|filter/i);
 }finally{db.close();}
});
test('cash deposit into bank is a matched internal movement, not new sales or capital',async()=>{
 const db=fixture();try {
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('C-DEP','2026-10-17','Cash Deposit','BA',40,0)").run();
  db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,debit,credit) VALUES ('B-DEP','BA','2026-10-17','Cash Deposit','BA',0,40)").run();
  db.native.prepare("UPDATE bank_accounts SET current_balance=240 WHERE bank_account_id='BA'").run();
  const page=await readCashExpenses(db,query('cash'));
  assert.equal(metric(page,'externalNetMovement').valueMinor,45000);
  assert.equal(metric(page,'internalTransferVolume').valueMinor,14000);
  assert.equal(metric(page,'bankCurrentBalance').valueMinor,39000);
 }finally{db.close();}
});


test('orphan active expense money-book posting withholds operating expense certification',async()=>{
 const db=fixture();try {
  // The live cash-book has an expense debit with no active source expense.
  // A matching master expense must exist; a cash movement alone cannot
  // certify the operating expense total.
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('C-EXP-ORPHAN','2026-10-19','Expense','EXP-MISSING',15,0)").run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const page=await readCashExpenses(db,query('expenses'));
  assert.equal(page.coverage.status,'incomplete');
  assert.match(page.coverage.reason,/expense.*(source|missing|orphan)|money.book/i);
  assert.equal(page.totalRows,1,'orphan must not manufacture an expense header');
  assert.equal(page.rows[0].sourceId,'EXP-001');
  assert.equal(metric(page,'operatingExpenses').valueMinor,null,
    'source-incomplete money-book expenses cannot certify a whole-period expense total');
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before);
 }finally{db.close();}
});

test('5G22: altered Finance source posting date must withhold period totals and keep reports read-only',async()=>{
 const db=fixture();try{
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const baseline=await readCashExpenses(db,query('finance'));
  assert.equal(baseline.coverage.status,'needs-review');
  assert.equal(metric(baseline,'ownerCapitalIn').valueMinor,30000);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before);
  db.native.prepare("UPDATE cash_book SET date='2026-10-17' WHERE entry_id='C-CAP'").run();
  const alteredBefore=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  for(const report of ['finance','cash'] as const){
   const page=await readCashExpenses(db,query(report));
   assert.equal(page.coverage.status,'incomplete',report+' must reject source/journal date drift');
   assert.match(page.coverage.reason,/finance|date|posting/i);
   assert.equal(metric(page,'ownerCapitalIn').valueMinor,null);
   assert.equal(metric(page,'cashReceipts').valueMinor,null);
   if(report==='finance')assert.equal(page.rows[0].amountMinor,null);
  }
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,alteredBefore,
   'Report GET must not alter tampered source, journals or money balances');
 }finally{db.close();}
});

test('5G22: Finance source outside the selected period cannot hide its in-period Cash journal mismatch',async()=>{
 const db=fixture();try{
  // October journal remains posted, but its financing source is falsely dated in September.
  db.native.prepare("UPDATE finance_transactions SET date='2026-09-30' WHERE finance_id='FIN-001'").run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  for(const report of ['cash','finance'] as const){
   const page=await readCashExpenses(db,query(report));
   assert.equal(page.coverage.status,'incomplete',report+' must detect an in-period journal whose Finance source is outside the reporting window');
   assert.match(page.coverage.reason,/finance|posting|date/i);
   assert.equal(metric(page,'cashReceipts').valueMinor,null);
   assert.equal(metric(page,'ownerCapitalIn').valueMinor,null);
   if(report==='finance')assert.equal(page.totalRows,0,'September source must not become an October Finance row');
  }
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,
   'Reporting must be read-only even for out-of-period Finance sources');
 }finally{db.close();}
});

test('5G24: orphan owner-capital money journal cannot certify the Cash or Finance reports',async()=>{
 const db=fixture();try{
  const baseline=await readCashExpenses(db,query('cash'));
  assert.equal(baseline.coverage.status,'needs-review');
  assert.equal(metric(baseline,'ownerCapitalIn').valueMinor,30000);
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit) VALUES ('C-FIN-ORPHAN','2026-10-19','Owner Investment','FIN-MISSING','Orphan capital posting',0,55)").run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  for(const report of ['cash','finance'] as const){
   const page=await readCashExpenses(db,query(report));
   assert.equal(page.coverage.status,'incomplete',report+' must reject the capital posting without a Finance source');
   assert.match(page.coverage.reason,/financ|capital|source|orphan/i);
   assert.equal(metric(page,'cashReceipts').valueMinor,null);
   assert.equal(metric(page,'ownerCapitalIn').valueMinor,null);
   if(report==='finance')assert.deepEqual(page.rows.map(x=>x.sourceId),['FIN-001'],
     'An orphan journal cannot manufacture a Finance source row');
  }
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,
   'Report reads cannot repair or modify the orphan journal');
 }finally{db.close();}
});
