import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {startCashSessionRoute,closeCashSessionRoute,getCashSessionSummaryRoute} from '../server/modules/sales/service.ts';
import {transferBankRoute,addFinanceTransactionRoute,getFinancePersonLedgerRoute,getBankReconciliationRoute} from '../server/modules/finance/service.ts';
import {addExpenseRoute} from '../server/modules/expenses/service.ts';
import {getDayBookRoute} from '../server/modules/reporting/service.ts';

const date=new Date().toISOString().slice(0,10);
const user={userId:'P6G-ADMIN',fullName:'Phase Six Cashier',role:'admin'} as any;
const read=async(r:Response)=>({status:r.status,...await r.json() as Record<string,any>});
test('6G full finance flow: capital, transfer, loan, bank/cash expenses, Daybook, reconciliation, cash close',async()=>{
 const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
 try{
  db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES('P6G-ADMIN','Phase Six Cashier','01000008697','fixture','fixture','admin','Active','Fixture')").run();
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES('P6G-BANK','Main Bank','Bank',300,300,'Active'),('P6G-WALLET','Wallet','Mobile Banking',100,100,'Active')").run();
  db.native.prepare("INSERT INTO finance_persons(person_id,person_name,person_type) VALUES('P6G-OWNER','Owner','Owner'),('P6G-LENDER','Lender','Lender')").run();
  db.native.prepare("INSERT INTO expense_categories(category_id,category_name) VALUES('P6G-CAT','Shop Costs')").run();
  const session=await read(await startCashSessionRoute(db,{openingCash:200,clientRequestId:'P6G-OPEN-00001'},user));
  assert.equal(session.status,200,JSON.stringify(session));
  const capital=await read(await addFinanceTransactionRoute(db,{
    personId:'P6G-OWNER',transactionType:'Owner Investment',paymentMethod:'Bank',bankAccountId:'P6G-BANK',
    amount:150,clientRequestId:'P6G-CAPITAL-0001'
  },user));
  assert.equal(capital.status,200,JSON.stringify(capital));
  const transfer=await read(await transferBankRoute(db,{
    fromAccountId:'P6G-BANK',toAccountId:'P6G-WALLET',amount:20,clientRequestId:'P6G-TRANSFER-001'
  },user));
  assert.equal(transfer.status,200,JSON.stringify(transfer));
  const bankExpense=await read(await addExpenseRoute(db,{
    categoryId:'P6G-CAT',paymentMethod:'Bank',bankAccountId:'P6G-BANK',
    amount:40,clientRequestId:'P6G-EXP-BANK-001',date
  },user));
  assert.equal(bankExpense.status,200,JSON.stringify(bankExpense));
  const cashExpense=await read(await addExpenseRoute(db,{
    categoryId:'P6G-CAT',paymentMethod:'Cash',amount:10,clientRequestId:'P6G-EXP-CASH-001',date
  },user));
  assert.equal(cashExpense.status,200,JSON.stringify(cashExpense));
  const loan=await read(await addFinanceTransactionRoute(db,{
    personId:'P6G-LENDER',transactionType:'Loan Received',paymentMethod:'Cash',
    amount:75,clientRequestId:'P6G-LOAN-000001'
  },user));
  assert.equal(loan.status,200,JSON.stringify(loan));
  assert.equal((await read(await getFinancePersonLedgerRoute(db,'P6G-OWNER',new URL('https://test.test/?pageSize=50')))).balance,150);
  assert.equal((await read(await getFinancePersonLedgerRoute(db,'P6G-LENDER',new URL('https://test.test/?pageSize=50')))).balance,75);
  const banks=await read(await getBankReconciliationRoute(db));
  assert.equal(banks.coverage.status,'ready',JSON.stringify(banks));
  assert.deepEqual(banks.accounts.map((a:any)=>[a.id,a.bookBalance]).sort(),[['P6G-BANK',390],['P6G-WALLET',120]]);
  const cash=await read(await getCashSessionSummaryRoute(db));
  assert.equal(cash.summary.openingCash,200);
  assert.equal(cash.summary.expectedCash,265);
  assert.equal(cash.summary.cashIn,75);
  assert.equal(cash.summary.cashOut,10);
  const day=await read(await getDayBookRoute(db,new URL('https://test.test/api/daybook?dateFrom='+date+'&dateTo='+date+'&page=1&pageSize=50'),user));
  assert.equal(day.status,200,JSON.stringify(day));
  assert.equal(day.totalRows,5);
  assert.equal(day.rows.filter((x:any)=>x.module==='Bank Transfer').length,1);
  assert.equal(day.totals.bankIn,150);
  assert.equal(day.totals.bankOut,40);
  assert.equal(day.totals.cashIn,75);
  assert.equal(day.totals.cashOut,10);
  const end=await read(await closeCashSessionRoute(db,{countedCash:265,clientRequestId:'P6G-CLOSE-00001'},user));
  assert.equal(end.status,200,JSON.stringify(end));
  assert.equal(end.variance,0);
  assert.equal((await read(await getCashSessionSummaryRoute(db))).summary,null);
  assert.equal((db.native.prepare("SELECT COUNT(*) n FROM cash_book WHERE type='Day Close Adjustment'").get() as any).n,0);
  assert.equal((db.native.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CASH_SESSION' AND action='CLOSE_CASH_SESSION'").get() as any).n,1);
 }finally{db.close();}
});
