import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('real v2 cash, bank, expense and finance GET routes are authenticated and never write D1',async()=>{
 const db=new SqliteDatabase(':memory:');
 try {
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(method:string,path:string,body?:unknown)=>{
   const res=await handleApiRequest(new Request('https://isolated.local'+path,{
     method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
     body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:res.status,...await res.json() as Record<string,any>};
  };
  assert.equal((await api('GET','/api/reports/v2/rows?report=cash')).status,401);
  const setup=await api('POST','/api/setup/admin',{
   fullName:'Finance Report Test Admin',phone:'01000009238',password:'LocalTestOnly2026'});
  assert.equal(setup.status,200,JSON.stringify(setup));token=setup.token;
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES "+
   "('CASH-SALE-5E','2026-10-20','Sale','INV-5E',0,200),"+
   "('CASH-EXP-5E','2026-10-20','Expense','EX-5E',50,0)").run();
  db.native.prepare("INSERT INTO expenses(expense_id,expense_date,category_id,category_name,amount,payment_method) "+
   "VALUES ('EX-5E','2026-10-20','C-UTIL','Utilities',50,'Cash')").run();
  const before=(db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
  const url='&from=2026-10-01&to=2026-10-30';
  const cash=await api('GET','/api/reports/v2/rows?report=cash'+url);
  assert.equal(cash.status,200,JSON.stringify(cash));
  assert.equal(cash.rows.length,2);
  assert.equal(cash.metrics.find((m:any)=>m.key==='cashReceipts')?.valueMinor,20000);
  assert.equal(cash.metrics.find((m:any)=>m.key==='cashPayments')?.valueMinor,5000);
  assert.equal(cash.metrics.find((m:any)=>m.key==='cashBookBalance')?.valueMinor,15000);
  assert.equal(cash.metrics.some((m:any)=>m.key==='netSales'),false);
  const expenses=await api('GET','/api/reports/v2/rows?report=expenses'+url);
  assert.equal(expenses.status,200,JSON.stringify(expenses));
  assert.deepEqual(expenses.rows.map((x:any)=>x.sourceId),['EX-5E']);
  assert.equal(expenses.metrics.find((m:any)=>m.key==='operatingExpenses')?.valueMinor,5000);
  const finance=await api('GET','/api/reports/v2/rows?report=finance'+url);
  assert.equal(finance.status,200);assert.deepEqual(finance.rows,[]);
  const bank=await api('GET','/api/reports/v2/rows?report=bank'+url);
  assert.equal(bank.status,200);assert.deepEqual(bank.rows,[]);
  const summary=await api('GET','/api/reports/v2/summary?from=2026-10-01&to=2026-10-30');
  assert.equal(summary.status,200,JSON.stringify(summary));
  assert.equal(summary.metrics.find((m:any)=>m.key==='cashBookBalance')?.valueMinor,15000);
  assert.equal(summary.metrics.find((m:any)=>m.key==='operatingExpenses')?.status,'ready',
    'a source-reconciled expense period is displayable even if physical cash remains unconfirmed');
  assert.equal((await api('POST','/api/reports/v2/rows?report=expenses',{})).status,404);
  const after=(db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
  assert.equal(after,before,'read-only reporting must not change D1');
  // A booked expense without its money-book proof must NEVER leak a second,
  // falsely verified operating-expense metric or a seemingly verified net profit.
  db.native.prepare("INSERT INTO expenses(expense_id,expense_date,category_id,category_name,amount,payment_method) "+
    "VALUES ('EX-MISSING-PROOF','2026-10-21','C-UNPOSTED','Unposted expense',70,'Cash')").run();
  const blocked=await api('GET','/api/reports/v2/summary?from=2026-10-01&to=2026-10-30');
  assert.equal(blocked.status,200,JSON.stringify(blocked));
  const expensesMetrics=blocked.metrics.filter((m:any)=>m.key==='operatingExpenses');
  assert.equal(expensesMetrics.length,1,'dashboard cannot emit contradictory expense metrics');
  assert.equal(expensesMetrics[0].valueMinor,null);
  assert.equal(blocked.metrics.find((m:any)=>m.key==='netProfit')?.valueMinor,null,
    'profit must be withheld if the operating expense provenance does not reconcile');
 } finally {db.close();}
});
