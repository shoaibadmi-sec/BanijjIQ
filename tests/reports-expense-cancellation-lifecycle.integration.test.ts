import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const period='&from=2026-01-01&to=2026-12-31';
const ok=(r:any)=>assert.equal(r.status,200,JSON.stringify(r));
function minor(page:any,key:string){
 const found=page.metrics?.find((m:any)=>m.key===key);
 assert.ok(found,'No '+key+' metric: '+JSON.stringify(page));
 return found.valueMinor;
}

test('Phase 5G19: cancelled edited Cash/Bank expenses restore books, preserve original evidence, and do not erase report certification',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  assert.ok(runMigrations(db.native,resolve('migrations')).applied.length>20);
  let token='';
  const one=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const many=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
  const count=(table:string)=>Number(one('SELECT COUNT(*) n FROM '+table).n);
  async function api(method:string,path:string,body?:unknown){
   const response=await handleApiRequest(new Request('http://phase5g19.local'+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  async function report(key:string){
   const r=await api('GET','/api/reports/v2/rows?report='+key+period);
   ok(r);return r;
  }
  const admin=await api('POST','/api/setup/admin',{fullName:'Expense Cancellation Test',
   phone:'01000008651',password:'Phase5G19-Local-2026!'});ok(admin);token=admin.token;
  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const bank=await api('POST','/api/bank/accounts',{name:'G19 Bank',accountType:'Bank',
   bankName:'Test Bank',openingBalance:200});ok(bank);
  const category=await api('POST','/api/expense-categories',{name:'G19 Repairs'});ok(category);
  const product=await api('POST','/api/products',{productName:'G19 Socket',category:'Electrical',
   unit:'Pcs',purchasePrice:20,sellingPrice:50,currentStock:3,minimumStock:0,
   status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false});ok(product);
  const sale=await api('POST','/api/pos/sales',{clientRequestId:crypto.randomUUID(),
   customerName:'G19 Cash Guest',customerPhone:'01000008652',paymentType:'Cash',
   paymentMethod:'Cash',items:[{productId:product.productId,name:'G19 Socket',
    qty:2,unitPrice:50,fulfillmentMode:'own'}],discount:0});ok(sale);
  assert.equal(sale.invoice.grandTotal,100);
  const owner=await api('POST','/api/finance/persons',{name:'G19 Owner',personType:'Owner'});ok(owner);
  const lender=await api('POST','/api/finance/persons',{name:'G19 Lender',personType:'Lender'});ok(lender);
  const investment=await api('POST','/api/finance/transactions',{personId:owner.id,
   transactionType:'Owner Investment',paymentMethod:'Cash',amount:200,clientRequestId:'G19-OWNER-CAPITAL-001'});ok(investment);
  const loan=await api('POST','/api/finance/transactions',{personId:lender.id,
   transactionType:'Loan Received',paymentMethod:'Bank',bankAccountId:bank.id,amount:100,clientRequestId:'G19-LOAN-POST-0001'});ok(loan);

  const cashExpense=(amount:number)=>({categoryId:category.id,paymentMethod:'Cash',
   description:'G19 adjusted cash expense',clientRequestId:crypto.randomUUID(),amount});
  const bankExpense=(amount:number)=>({categoryId:category.id,paymentMethod:'Bank',
   bankAccountId:bank.id,description:'G19 adjusted bank expense',clientRequestId:crypto.randomUUID(),amount});
  const cash=await api('POST','/api/expenses',cashExpense(30));ok(cash);
  const cashEdited=await api('PUT','/api/expenses/'+cash.id,cashExpense(40));ok(cashEdited);
  const cashCancelled=await api('POST','/api/expenses/'+cash.id+'/cancel',{
   reason:'Valid reversal of adjusted cash operating expense'});ok(cashCancelled);
  const bankExp=await api('POST','/api/expenses',bankExpense(25));ok(bankExp);
  ok(await api('PUT','/api/expenses/'+bankExp.id,bankExpense(35)));
  ok(await api('POST','/api/expenses/'+bankExp.id+'/cancel',{
   reason:'Valid reversal of adjusted bank operating expense'}));
  const stillActive=await api('POST','/api/expenses',cashExpense(15));ok(stillActive);

  const movements=(table:string,id:string)=>many(
   'SELECT type,debit,credit FROM '+table+' WHERE reference=? ORDER BY rowid',id)
   .map(x=>[x.type,x.debit,x.credit]);
  assert.deepEqual(movements('cash_book',cash.id),[
   ['Expense',30,0],['Expense Update',10,0],['Expense Deleted',0,40]
  ]);
  assert.deepEqual(movements('bank_book',bankExp.id),[
   ['Expense',25,0],['Expense Update',10,0],['Expense Deleted',0,35]
  ]);
  assert.equal(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bank.id).n,300);
  assert.equal(one('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,1);
  for(const id of [cash.id,bankExp.id]){
   const row=one('SELECT status,is_deleted,delete_reason FROM expenses WHERE expense_id=?',id);
   assert.equal(row.status,'Cancelled');assert.equal(row.is_deleted,1);assert.ok(row.delete_reason);
   assert.equal(one("SELECT COUNT(*) n FROM audit_logs WHERE action='DELETE_EXPENSE' AND entity_id=?",id).n,1);
  }
  assert.equal(count('expenses'),3);
  const before=one('SELECT total_changes() n').n;
  const r:Record<string,any>={};
  for(const key of ['cash','bank','expenses','finance','profit','stock'])r[key]=await report(key);
  assert.equal(one('SELECT total_changes() n').n,before,'reports must be read-only');
  assert.equal(r.cash.coverage.status,'needs-review','valid cancelled sources must still reconcile');
  assert.equal(r.profit.coverage.status,'ready','valid cancellations must not poison real profit');
  for(const [key,expected] of [
   ['cashReceipts',34000],['cashPayments',5500],['cashBookBalance',28500],
   ['bankReceipts',13500],['bankPayments',3500],['bankCurrentBalance',30000],
   ['ownerCapitalIn',20000],['operatingExpenses',1500]
  ] as const)assert.equal(minor(r.cash,key),expected,key);
  assert.equal(minor(r.expenses,'operatingExpenses'),1500);
  assert.deepEqual(r.expenses.rows.map((row:any)=>row.sourceId),[stillActive.id]);
  assert.deepEqual(r.finance.rows.map((row:any)=>row.sourceId).sort(),[investment.id,loan.id].sort());
  for(const [key,expected] of [
   ['netSales',10000],['fifoCogs',4000],['grossProfit',6000],
   ['operatingExpenses',1500],['netProfit',4500]
  ] as const)assert.equal(minor(r.profit,key),expected,key);
  assert.equal(minor(r.stock,'inventoryValue'),2000);

  const snapshot={bank:one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bank.id).n,
   cashBook:count('cash_book'),bankBook:count('bank_book'),expenses:count('expenses'),
   audit:count('audit_logs')};
  const repeated=await api('POST','/api/expenses/'+cash.id+'/cancel',{reason:'Again'});
  assert.notEqual(repeated.status,200);
  assert.deepEqual({bank:one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bank.id).n,
   cashBook:count('cash_book'),bankBook:count('bank_book'),expenses:count('expenses'),
   audit:count('audit_logs')},snapshot,'double cancellation must not post or audit twice');

  db.native.prepare("UPDATE cash_book SET credit=35 WHERE reference=? AND type='Expense Deleted'").run(cash.id);
  const tampered=await report('expenses');
  assert.equal(tampered.coverage.status,'incomplete','tampered cancelled reversal must fail closed');
  assert.equal(minor(tampered,'operatingExpenses'),null);
  assert.match(tampered.coverage.reason,/expense|cancel|reversal|money/i);
 }finally{db.close();}
});
