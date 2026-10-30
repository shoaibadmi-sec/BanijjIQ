import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {addExpenseRoute,updateExpenseRoute,cancelExpenseRoute} from '../server/modules/expenses/service.ts';
import {getBankReconciliationRoute} from '../server/modules/finance/service.ts';
import {getCashSessionSummaryRoute} from '../server/modules/sales/service.ts';
import {getDayBookRoute} from '../server/modules/reporting/service.ts';

const date=new Date().toISOString().slice(0,10);
const user={userId:'P6F-ADMIN',fullName:'Test Cashier',role:'admin'} as any;
const payload=(amount=30,method='Bank',clientRequestId='P6F-EXP-00001')=>({
  categoryId:'CAT-EXP',amount,paymentMethod:method,
  bankAccountId:method==='Cash'?'':method==='Mobile Banking'?'BK-MOBILE':'BK-EXP',
  description:'Expense for shop rent',clientRequestId,date
});
function fixture(){
 const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
 db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES('P6F-ADMIN','Test Cashier','01000008698','fixture','fixture','admin','Active','Fixture')").run();
 db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash,status) VALUES ('P6F-SESSION','Test Cashier',500,'Open')").run();
 db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('P6F-OPEN',?,'Session Open','P6F-SESSION',0,500)").run(date);
 db.native.prepare("INSERT INTO expense_categories(category_id,category_name) VALUES ('CAT-EXP','Shop Rent')").run();
 db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES ('BK-EXP','Operating Bank','Bank',100,100,'Active'),('BK-MOBILE','Mobile Wallet','Mobile Banking',30,30,'Active'),('BK-INACTIVE','Inactive Bank','Bank',50,50,'Inactive')").run();
 const expenses=()=>db.native.prepare('SELECT * FROM expenses ORDER BY expense_id').all() as any[];
 const book=(table:'bank_book'|'cash_book',reference?:string)=>db.native.prepare('SELECT * FROM '+table+(reference?' WHERE reference=?':'')+' ORDER BY rowid').all(...(reference?[reference]:[])) as any[];
 const balance=(id='BK-EXP')=>(db.native.prepare('SELECT current_balance AS n FROM bank_accounts WHERE bank_account_id=?').get(id) as any).n;
 const countAudit=()=>(db.native.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='EXPENSE'").get() as any).n;
 return {db,expenses,book,balance,countAudit};
}
async function read(r:Response){return {status:r.status,...await r.json() as Record<string,any>};}
test('6F bank expense is posted once and reconciles both account and Daybook',async()=>{
 const f=fixture();try{
  const first=await read(await addExpenseRoute(f.db,payload(),user));
  assert.equal(first.status,200,JSON.stringify(first));
  const retry=await read(await addExpenseRoute(f.db,payload(),user));
  assert.equal(retry.status,200,JSON.stringify(retry));
  assert.equal(retry.id,first.id);
  assert.equal(f.expenses().length,1);
  assert.equal(f.book('bank_book',first.id).length,1);
  assert.equal(f.balance(),70);
  const reconcile=await read(await getBankReconciliationRoute(f.db));
  const account=reconcile.accounts.find((a:any)=>a.id==='BK-EXP');
  assert.equal(account.status,'ready',JSON.stringify(account));
  assert.equal(account.bookBalance,70);
  const day=await read(await getDayBookRoute(f.db,new URL('https://test.test/api/daybook?dateFrom='+date+'&dateTo='+date+'&module=Expense&page=1&pageSize=50'),user));
  assert.equal(day.status,200);
  assert.equal(day.totalRows,1);
  assert.equal(day.rows[0].sourceId,first.id);
  assert.equal(day.totals.bankOut,30);
  assert.equal((await read(await addExpenseRoute(f.db,{...payload(),amount:31},user))).status,409);
 }finally{f.db.close();}
});
test('6F failed bank money posting atomically rolls back expense header and bank balance',async()=>{
 const f=fixture();try{
  f.db.native.exec("CREATE TRIGGER p6f_bank_insert_fail BEFORE INSERT ON bank_book WHEN NEW.type='Expense' BEGIN SELECT RAISE(ABORT,'forced bank failure'); END;");
  let result:Response|undefined;
  try{result=await addExpenseRoute(f.db,payload(),user);}catch{}
  assert.notEqual(result?.status,200);
  assert.equal(f.expenses().length,0);
  assert.equal(f.book('bank_book').length,0);
  assert.equal(f.balance(),100);
 }finally{f.db.close();}
});
test('6F rejects zero, negative, sub-precision, inactive and mismatched account without posting',async()=>{
 const f=fixture();try{
  const bad=[
    {...payload(0)},
    {...payload(-3)},
    {...payload(0.00001)},
    {...payload(),bankAccountId:'BK-INACTIVE'},
    {...payload(),paymentMethod:'Mobile Banking',bankAccountId:'BK-EXP'},
    {...payload(500)}
  ];
  for(const p of bad){const r=await read(await addExpenseRoute(f.db,p,user));assert.notEqual(r.status,200,JSON.stringify({p,r}));}
  assert.equal(f.expenses().length,0);
  assert.equal(f.book('bank_book').length,0);
  assert.equal(f.balance(),100);
 }finally{f.db.close();}
});
test('6F failed bank-to-cash expense edit restores old amount, bank posting and cash',async()=>{
 const f=fixture();try{
  const old=await read(await addExpenseRoute(f.db,payload(),user));
  assert.equal(old.status,200);
  f.db.native.exec("CREATE TRIGGER p6f_cash_edit_fail BEFORE INSERT ON cash_book WHEN NEW.type='Expense Update' BEGIN SELECT RAISE(ABORT,'cash leg failed'); END;");
  let changed:Response|undefined;
  const edit={...payload(22,'Cash'),description:'Shop rent expense corrected'};
  try{changed=await updateExpenseRoute(f.db,old.id,edit);}catch{}
  assert.notEqual(changed?.status,200);
  assert.equal(f.expenses()[0].payment_method,'Bank');
  assert.equal(f.expenses()[0].amount,30);
  assert.equal(f.balance(),70);
  assert.equal(f.book('bank_book',old.id).length,1);
  assert.equal(f.book('cash_book',old.id).length,0);
  f.db.native.exec('DROP TRIGGER p6f_cash_edit_fail');
  const ok=await read(await updateExpenseRoute(f.db,old.id,edit));
  assert.equal(ok.status,200,JSON.stringify(ok));
  assert.equal(f.balance(),100);
  assert.equal(f.expenses()[0].amount,22);
  assert.equal(f.book('cash_book',old.id).reduce((n:number,e:any)=>n+e.debit-e.credit,0),22);
  const summary=await read(await getCashSessionSummaryRoute(f.db));
  assert.equal(summary.summary.expectedCash,478);
 }finally{f.db.close();}
});
test('6F expense cancellation requires audit, is atomic, and never double-refunds',async()=>{
 const f=fixture();try{
  const first=await read(await addExpenseRoute(f.db,payload(),user));
  assert.equal(first.status,200);
  f.db.native.exec("CREATE TRIGGER p6f_audit_fail BEFORE INSERT ON audit_logs WHEN NEW.action='DELETE_EXPENSE' BEGIN SELECT RAISE(ABORT,'audit insert blocked'); END;");
  let cancelled:Response|undefined;
  try{cancelled=await cancelExpenseRoute(f.db,first.id,'Duplicate shop rent - verified',user);}catch{}
  assert.notEqual(cancelled?.status,200);
  assert.equal(f.expenses()[0].status,'Active');
  assert.equal(f.balance(),70);
  assert.equal(f.book('bank_book',first.id).length,1);
  f.db.native.exec('DROP TRIGGER p6f_audit_fail');
  const ok=await read(await cancelExpenseRoute(f.db,first.id,'Duplicate shop rent - verified',user));
  assert.equal(ok.status,200,JSON.stringify(ok));
  assert.equal(f.balance(),100);
  assert.equal(f.countAudit(),1);
  const again=await read(await cancelExpenseRoute(f.db,first.id,'Duplicate shop rent - verified',user));
  assert.notEqual(again.status,200);
  assert.equal(f.countAudit(),1);
  assert.equal(f.balance(),100);
  assert.equal(f.book('bank_book',first.id).reduce((n:number,e:any)=>n+e.debit-e.credit,0),0);
 }finally{f.db.close();}
});
test('6F cash expense and bank expense never mix drawer and bank book',async()=>{
 const f=fixture();try{
  const result=await read(await addExpenseRoute(f.db,payload(25,'Cash','P6F-CASH-00001'),user));
  assert.equal(result.status,200);
  assert.equal(f.book('cash_book',result.id).length,1);
  assert.equal(f.book('bank_book',result.id).length,0);
  assert.equal(f.balance(),100);
  const summary=await read(await getCashSessionSummaryRoute(f.db));
  assert.equal(summary.summary.openingCash,500);
  assert.equal(summary.summary.expectedCash,475);
  assert.equal(summary.summary.cashOut,25);
 }finally{f.db.close();}
});

test('6F role-gated expense API denies posting, correction and cancellation to a reader',async()=>{
 const f=fixture();try{
  const {createHash}=await import('node:crypto');
  const {handleApiRequest}=await import('../server/core/handler.ts');
  const token='P6F-expense-reader-token-2026';
  f.db.native.prepare("INSERT INTO app_roles(role_name,permissions_json) VALUES ('P6F-READER',?)")
   .run(JSON.stringify({expense:{view:true,add:false,edit:false}}));
  f.db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('P6F-READER','Expense Reader','01000008696','fixture','fixture','P6F-READER','Active','Fixture')").run();
  f.db.native.prepare("INSERT INTO auth_sessions(session_id,user_id,token_hash,expires_at) VALUES ('P6F-AUTH','P6F-READER',?,datetime('now','+2 hours'))")
   .run(createHash('sha256').update(token).digest('base64'));
  async function req(method:string,path:string,body?:any,auth=token){
   return handleApiRequest(new Request('https://test.invalid'+path,{
     method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},
     body:body?JSON.stringify(body):undefined
   }),f.db);
  }
  assert.equal((await req('GET','/api/expenses')).status,200);
  assert.equal((await req('POST','/api/expenses',payload())).status,403);
  assert.equal((await req('PUT','/api/expenses/NOT-FOUND',payload())).status,403);
  assert.equal((await req('POST','/api/expenses/NOT-FOUND/cancel',{reason:'Reversal after approval'})).status,403);
  assert.equal((await req('GET','/api/bank/reconciliation')).status,403);
  assert.equal((await req('POST','/api/expenses',payload(),'invalid-token')).status,401);
  assert.equal(f.expenses().length,0);
 }finally{f.db.close();}
});
