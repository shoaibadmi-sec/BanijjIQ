import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const period='&from=2026-01-01&to=2026-12-31';
const ok=(r:any)=>assert.equal(r.status,200,JSON.stringify(r));
const metric=(page:any,key:string)=>{
 const found=page.metrics?.find((m:any)=>m.key===key);
 assert.ok(found,'Missing '+key+' in '+JSON.stringify(page));
 return found.valueMinor;
};

test('5G18: real owner capital + bank loan + internal transfer + two expenses + FIFO sale reconcile report sources',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  assert.ok(runMigrations(db.native,resolve('migrations')).applied.length>20);
  let token='';
  const one=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
  const many=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
  const count=(table:string)=>Number(one('SELECT COUNT(*) n FROM '+table).n);
  async function api(method:string,path:string,body?:unknown){
   const response=await handleApiRequest(new Request('http://phase5g18.local'+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
   }),db);
   return {status:response.status,...await response.json() as Record<string,any>};
  }
  async function report(name:string){
   const response=await api('GET','/api/reports/v2/rows?report='+name+period);
   ok(response);return response;
  }
  const admin=await api('POST','/api/setup/admin',{fullName:'G18 Finance Audit',
   phone:'01000008261',password:'G18-Accounting-Fixture-2026!'});ok(admin);
  token=admin.token;
  ok(await api('POST','/api/pos/cash-session/start',{openingCash:0}));
  const bankA=await api('POST','/api/bank/accounts',{
   name:'G18 Main Bank',bankName:'Testing Bank',accountType:'Bank',openingBalance:500
  });ok(bankA);
  const bankB=await api('POST','/api/bank/accounts',{
   name:'G18 Reserve Bank',bankName:'Testing Bank',accountType:'Bank',openingBalance:100
  });ok(bankB);
  const bankBalance=(id:string)=>Number(one('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',id).n);
  const owner=await api('POST','/api/finance/persons',{name:'G18 Owner',personType:'Owner'});ok(owner);
  const lender=await api('POST','/api/finance/persons',{name:'G18 Lender',personType:'Lender'});ok(lender);
  const equity=await api('POST','/api/finance/transactions',{
   transactionType:'Owner Investment',personId:owner.id,paymentMethod:'Cash',amount:200,
   notes:'Real owner capital, not sales'
  });ok(equity);
  const loan=await api('POST','/api/finance/transactions',{
   transactionType:'Loan Received',personId:lender.id,paymentMethod:'Bank',
   bankAccountId:bankA.id,amount:300,notes:'Liability financing not income'
  });ok(loan);
  assert.equal(bankBalance(bankA.id),800);
  const transferred=await api('POST','/api/bank/transfers',{
   fromAccountId:bankA.id,toAccountId:bankB.id,amount:120,
   notes:'Internal treasury allocation - not revenue'
  });ok(transferred);
  assert.equal(bankBalance(bankA.id),680);
  assert.equal(bankBalance(bankB.id),220);
  const transferRows=many("SELECT bank_account_id,type,reference,debit,credit FROM bank_book WHERE reference=? ORDER BY type",transferred.id);
  assert.deepEqual(transferRows.map(x=>[x.bank_account_id,x.type,x.debit,x.credit]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]))),[
   [bankB.id,'Transfer In',0,120],[bankA.id,'Transfer Out',120,0]
  ]);
  assert.equal(count('bank_transfers'),1);

  const category=await api('POST','/api/expense-categories',{name:'G18 Utilities'});ok(category);
  const bankExpense=await api('POST','/api/expenses',{
   categoryId:category.id,paymentMethod:'Bank',bankAccountId:bankB.id,
   amount:40,description:'G18 bank expense'
  });ok(bankExpense);
  const cashExpense=await api('POST','/api/expenses',{
   categoryId:category.id,paymentMethod:'Cash',amount:30,
   description:'G18 cash expense'
  });ok(cashExpense);
  assert.equal(bankBalance(bankB.id),180);
  assert.equal(bankBalance(bankA.id)+bankBalance(bankB.id),860);
  const p=await api('POST','/api/products',{
   productName:'G18 Test Plug',category:'Electrical',unit:'Pcs',purchasePrice:20,
   sellingPrice:50,currentStock:3,minimumStock:0,status:'Active',
   trackSerial:false,trackExpiry:false,trackWarranty:false
  });ok(p);
  const sale=await api('POST','/api/pos/sales',{
   clientRequestId:'phase5g18-cash-pos-unique-1',customerName:'G18 Cash Guest',
   customerPhone:'01000008262',paymentType:'Cash',paymentMethod:'Cash',
   discount:0,items:[{productId:p.productId,name:'G18 Test Plug',qty:2,
    unitPrice:50,fulfillmentMode:'own'}]
  });ok(sale);
  assert.equal(sale.invoice.grandTotal,100);
  assert.equal(one('SELECT current_stock n FROM products WHERE product_id=?',p.productId).n,1);
  assert.equal(one('SELECT SUM(quantity * unit_cost) n FROM sale_item_lots WHERE invoice_id=?',sale.invoice.invoiceId).n,40);

  assert.deepEqual(many("SELECT type,reference,credit,debit FROM cash_book WHERE type IN ('Owner Investment','Expense','Sale') ORDER BY type")
   .map(x=>[x.type,x.credit,x.debit]),[
    ['Expense',0,30],['Owner Investment',200,0],['Sale',100,0]
   ]);
  assert.equal(one('SELECT COUNT(*) n FROM bank_book WHERE reference=? AND type=?',loan.id,'Loan Received').n,1);
  assert.equal(one('SELECT COUNT(*) n FROM bank_book WHERE reference=? AND type=?',bankExpense.id,'Expense').n,1);
  assert.equal(one('SELECT COUNT(*) n FROM cash_book WHERE reference=? AND type=?',cashExpense.id,'Expense').n,1);

  const before=one('SELECT total_changes() n').n;
  const reports:Record<string,any>={};
  for(const key of ['cash','bank','finance','expenses','profit','stock','receivables','payables'])
   reports[key]=await report(key);
  assert.equal(one('SELECT total_changes() n').n,before,'Every report must be read-only');
  for(const [key,expected] of [
   ['cashReceipts',30000],['cashPayments',3000],['cashBookBalance',27000],
   ['bankReceipts',42000],['bankPayments',16000],['bankCurrentBalance',86000],
   ['internalTransferVolume',12000],['externalNetMovement',53000],
   ['ownerCapitalIn',20000],['operatingExpenses',7000]
  ] as const)
   assert.equal(metric(reports.cash,key),expected,key);
  assert.equal(metric(reports.bank,'bankCurrentBalance'),86000);
  assert.equal(metric(reports.expenses,'operatingExpenses'),7000);
  assert.equal(metric(reports.finance,'ownerCapitalIn'),20000);
  for(const [key,expected] of [
   ['netSales',10000],['fifoCogs',4000],['grossProfit',6000],
   ['operatingExpenses',7000],['netProfit',-1000]
  ] as const)
   assert.equal(metric(reports.profit,key),expected,key);
  assert.equal(reports.profit.coverage.status,'ready',JSON.stringify(reports.profit.coverage));
  assert.equal(metric(reports.stock,'inventoryValue'),2000);
  assert.equal(metric(reports.receivables,'receivablesBalance'),0);
  assert.equal(metric(reports.payables,'payablesBalance'),0);
  assert.equal(reports.cash.coverage.status,'needs-review',
   'cash/bank balance snapshots require explicit physical and statement reconciliation');
  assert.deepEqual(reports.finance.rows.map((x:any)=>x.sourceId).sort(),[equity.id,loan.id].sort());
  assert.deepEqual(reports.expenses.rows.map((x:any)=>x.sourceId).sort(),[bankExpense.id,cashExpense.id].sort());

  // A forged extra transfer leg must make money reports fail closed, not publish plausible totals.
  const snapshot={accounts:[bankBalance(bankA.id),bankBalance(bankB.id)],
   entries:count('bank_book'),finance:count('finance_transactions'),
   expenses:count('expenses'),sale:count('sales')};
  db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,debit,credit) VALUES (?,?,date('now'),'Transfer In',?,0,120)")
   .run('G18-UNMATCHED-BANK-LEG',bankB.id,transferred.id);
  const invalid=await report('bank');
  assert.equal(invalid.coverage.status,'incomplete','Unbalanced transfer must not appear trusted');
  assert.equal(metric(invalid,'bankCurrentBalance'),null);
  assert.equal(metric(invalid,'internalTransferVolume'),null);
  assert.deepEqual([bankBalance(bankA.id),bankBalance(bankB.id)],snapshot.accounts,
   'Read-only failure report cannot silently adjust bank balances');
  assert.deepEqual([count('finance_transactions'),count('expenses'),count('sales')],
   [snapshot.finance,snapshot.expenses,snapshot.sale]);
 }finally{db.close();}
});
