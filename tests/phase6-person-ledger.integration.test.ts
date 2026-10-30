import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {addFinanceTransactionRoute} from '../server/modules/finance/service.ts';

function fixture(){
  const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
  db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES('FIN-TEST-ADMIN','Finance Tester','01000006622','fixture','fixture','admin','Active','Fixture')").run();
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash,status) VALUES('FIN-SESSION','Finance Tester',0,'Open')").run();
  db.native.prepare("INSERT INTO finance_persons(person_id,person_name,person_type) VALUES('OWNER-1','Owner One','Owner'),('OWNER-2','Owner Two','Owner'),('LENDER-1','Loan Partner','Lender')").run();
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES('FIN-BANK','Finance Bank','Bank',0,60,'Active')").run();
  const person=(id:string,name:string,type:string,amount:number,date:string,method='Cash',account='')=>{
    db.native.prepare('INSERT INTO finance_transactions(finance_id,date,transaction_type,person_id,person_name,payment_method,bank_account_id,bank_account_name,amount) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id,date,type,name==='Owner Two'?'OWNER-2':name==='Loan Partner'?'LENDER-1':'OWNER-1',name,method,account,account?'Finance Bank':'',amount);
    const credit=/^(Owner Investment|Opening Owner Capital|Loan Received|Opening Loan)$/.test(type)?amount:0, debit=credit?0:amount;
    if(method==='Cash')db.native.prepare('INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit) VALUES(?,?,?,?,?,?,?)')
      .run('CB-'+id,date,type,id,'financing',debit,credit);
    else db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,debit,credit,status) VALUES(?,?,?,?,?,?,?,?,?)")
      .run('BB-'+id,account,'Finance Bank',date,type,id,debit,credit,'Active');
  };
  return {db,person,user:{userId:'FIN-TEST-ADMIN',fullName:'Finance Tester',role:'admin'} as any};
}
async function read(db:SqliteDatabase,id:string,query=''){
  const {getFinancePersonLedgerRoute}=await import('../server/modules/finance/service.ts');
  const r=await getFinancePersonLedgerRoute(db,id,new URL('https://isolated.test/?'+query));
  return {status:r.status,...await r.json() as Record<string,any>};
}
test('6D ledger is per immutable person ID, separates capital and loans and reconciles source books',async()=>{
  const f=fixture();
  try{
    f.person('FIN-01','Owner One','Owner Investment',120,'2026-10-25');
    f.person('FIN-02','Owner One','Owner Withdrawal',20,'2026-10-26');
    f.person('FIN-03','Owner Two','Owner Investment',80,'2026-10-25');
    f.person('FIN-04','Loan Partner','Loan Received',90,'2026-10-25','Bank','FIN-BANK');
    f.person('FIN-05','Loan Partner','Loan Repayment',30,'2026-10-26','Bank','FIN-BANK');
    const before=(f.db.native.prepare('SELECT total_changes() n').get() as any).n;
    const owner=await read(f.db,'OWNER-1');
    assert.equal(owner.status,200,JSON.stringify(owner));
    assert.equal(owner.coverage.status,'ready');
    assert.equal(owner.person.type,'Owner');
    assert.equal(owner.balance,100);
    assert.equal(owner.totalRows,2);
    assert.deepEqual(owner.rows.map((r:any)=>[r.financeId,r.debit,r.credit,r.balance]),
      [['FIN-02',20,0,100],['FIN-01',0,120,120]]);
    assert.ok(owner.rows.every((r:any)=>r.personId==='OWNER-1'&&r.sourceStatus==='matched'));
    assert.equal((await read(f.db,'OWNER-2')).balance,80);
    const lender=await read(f.db,'LENDER-1');
    assert.equal(lender.balance,60);assert.equal(lender.person.type,'Lender');
    assert.equal(lender.rows.length,2);
    assert.ok(lender.rows.every((r:any)=>r.paymentMethod==='Bank'));
    const after=(f.db.native.prepare('SELECT total_changes() n').get() as any).n;
    assert.equal(after,before,'ledger read cannot write any financial records');
  }finally{f.db.close();}
});
test('6D missing, duplicate or mismatched cash/bank postings fail closed: no verified person balance',async()=>{
  const f=fixture();
  try{
    f.person('FIN-01','Owner One','Owner Investment',120,'2026-10-25');
    f.db.native.prepare("UPDATE cash_book SET credit=90 WHERE reference='FIN-01'").run();
    let owner=await read(f.db,'OWNER-1');
    assert.equal(owner.coverage.status,'needs-review');
    assert.equal(owner.balance,null);
    assert.ok(owner.rows.every((r:any)=>r.balance===null));
    f.db.native.prepare("UPDATE cash_book SET credit=120 WHERE reference='FIN-01'").run();
    f.db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES('CB-DUP','2026-10-25','Owner Investment','FIN-01',0,120)").run();
    owner=await read(f.db,'OWNER-1');
    assert.equal(owner.coverage.status,'needs-review');assert.equal(owner.balance,null);
    f.db.native.prepare("UPDATE cash_book SET is_deleted=1 WHERE entry_id='CB-DUP'").run();
    owner=await read(f.db,'OWNER-1');
    assert.equal(owner.coverage.status,'ready');assert.equal(owner.balance,120);
    f.db.native.prepare("UPDATE cash_book SET is_deleted=1 WHERE reference='FIN-01'").run();
    assert.equal((await read(f.db,'OWNER-1')).balance,null);
    const unknown=await read(f.db,'MISSING');
    assert.equal(unknown.status,404);
  }finally{f.db.close();}
});
test('6D immutable person ledger filters by date and paginates 50/100 with opening balance',async()=>{
  const f=fixture();
  try{
    for(let n=1;n<=52;n++)f.person('FIN-'+String(n).padStart(4,'0'),'Owner One','Owner Investment',1,
      n<=10?'2026-10-24':'2026-10-25');
    const a=await read(f.db,'OWNER-1','page=1&pageSize=50');
    assert.equal(a.totalRows,52);assert.equal(a.rows.length,50);assert.equal(a.totalPages,2);assert.equal(a.balance,52);
    const b=await read(f.db,'OWNER-1','page=2&pageSize=50');
    assert.equal(b.rows.length,2);
    const c=await read(f.db,'OWNER-1','pageSize=100&dateFrom=2026-10-25&dateTo=2026-10-25');
    assert.equal(c.totalRows,42);assert.equal(c.openingBalance,10);assert.equal(c.closingBalance,52);
    assert.equal((await read(f.db,'OWNER-1','pageSize=5')).status,400);
    assert.equal((await read(f.db,'OWNER-1','dateFrom=2026-10-31&dateTo=2026-10-25')).status,400);
  }finally{f.db.close();}
});
test('6D person ledger endpoint requires finance.view and hides bank data from finance-only staff',async()=>{
  const f=fixture();
  try{
    const {createHash}=await import('node:crypto');
    const staffToken='phase6-finance-person-read-only';
    f.db.native.prepare("INSERT INTO app_roles(role_name,permissions_json) VALUES('finance-reader',?)").run(JSON.stringify({finance:{view:true}}));
    f.db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES('FIN-READER','Finance Reader','01000006623','fixture','fixture','finance-reader','Active','Fixture')").run();
    f.db.native.prepare("INSERT INTO auth_sessions(session_id,user_id,token_hash,expires_at) VALUES('FIN-AUTH','FIN-READER',?,datetime('now','+2 hours'))")
      .run(createHash('sha256').update(staffToken).digest('base64'));
    async function request(token=''){
      const r=await handleApiRequest(new Request('https://isolated.test/api/finance/persons/OWNER-1/ledger',{
        headers:token?{authorization:'Bearer '+token}:undefined
      }),f.db);
      return {status:r.status,...await r.json() as Record<string,any>};
    }
    assert.equal((await request()).status,401);
    assert.equal((await request(staffToken)).status,200);
    const b=await handleApiRequest(new Request('https://isolated.test/api/bank/reconciliation',{headers:{authorization:'Bearer '+staffToken}}),f.db);
    assert.equal(b.status,403);
  }finally{f.db.close();}
});
test('6D finance posting failure rolls back header, even when bank or cash book insert fails',async()=>{
  const f=fixture();
  try{
    f.db.native.exec("CREATE TRIGGER phase6_finance_cash_fail BEFORE INSERT ON cash_book WHEN NEW.type='Owner Investment' BEGIN SELECT RAISE(ABORT,'cash leg failed'); END;");
    const input={personId:'OWNER-1',transactionType:'Owner Investment',amount:25,paymentMethod:'Cash',clientRequestId:'PHASE6-FINANCE-POST-001'};
    let result:Response|undefined;
    try{result=await addFinanceTransactionRoute(f.db,input,f.user);}catch{}
    assert.notEqual(result?.status,200);
    assert.equal((f.db.native.prepare("SELECT COUNT(*) n FROM finance_transactions").get() as any).n,0,
      'finance header cannot survive missing source money posting');
    assert.equal((f.db.native.prepare("SELECT COUNT(*) n FROM cash_book WHERE type='Owner Investment'").get() as any).n,0);
  }finally{f.db.close();}
});

test('6D posting uses a stable request ID, blocks wrong person type, and never doubles owner capital',async()=>{
 const f=fixture();
 try{
  const input={personId:'OWNER-1',transactionType:'Owner Investment',amount:32.125,paymentMethod:'Cash',clientRequestId:'P6D-OWNER-POST-0001'};
  const first=await addFinanceTransactionRoute(f.db,input,f.user);
  assert.equal(first.status,200);
  const firstPayload=await first.json() as any;
  const retry=await addFinanceTransactionRoute(f.db,input,f.user);
  assert.equal(retry.status,200);
  assert.equal((await retry.json() as any).id,firstPayload.id);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM finance_transactions').get() as any).n,1);
  assert.equal((f.db.native.prepare("SELECT COUNT(*) n FROM cash_book WHERE type='Owner Investment'").get() as any).n,1);
  assert.equal((await read(f.db,'OWNER-1')).balance,32.125);
  assert.equal((await addFinanceTransactionRoute(f.db,{...input,amount:33},f.user)).status,409);
  assert.notEqual((await addFinanceTransactionRoute(f.db,{...input,clientRequestId:'P6D-WRONG-KIND',personId:'LENDER-1'},f.user)).status,200);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM finance_transactions').get() as any).n,1);
 }finally{f.db.close();}
});
test('6D bank posting uses the original account, rejects inactive account and rolls back failed leg',async()=>{
 const f=fixture();
 try{
  f.db.native.prepare("UPDATE bank_accounts SET current_balance=0 WHERE bank_account_id='FIN-BANK'").run();
  const input={personId:'LENDER-1',transactionType:'Loan Received',amount:90,paymentMethod:'Bank',bankAccountId:'FIN-BANK',clientRequestId:'P6D-LOAN-IN-00001'};
  const posted=await addFinanceTransactionRoute(f.db,input,f.user);
  assert.equal(posted.status,200);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='FIN-BANK'").get() as any).n,90);
  const out=await addFinanceTransactionRoute(f.db,{...input,transactionType:'Loan Repayment',amount:30,clientRequestId:'P6D-LOAN-OUT-0001'},f.user);
  assert.equal(out.status,200);
  assert.equal((await read(f.db,'LENDER-1')).balance,60);
  f.db.native.prepare("UPDATE bank_accounts SET status='Inactive' WHERE bank_account_id='FIN-BANK'").run();
  const blocked=await addFinanceTransactionRoute(f.db,{...input,clientRequestId:'P6D-LOAN-INACTIVE'},f.user);
  assert.notEqual(blocked.status,200);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM finance_transactions').get() as any).n,2);
  f.db.native.prepare("UPDATE bank_accounts SET status='Active' WHERE bank_account_id='FIN-BANK'").run();
  f.db.native.exec("CREATE TRIGGER p6d_bank_leg_failure BEFORE INSERT ON bank_book WHEN NEW.reference LIKE 'FIN-%' BEGIN SELECT RAISE(ABORT,'bank insert failed'); END;");
  const failed=await addFinanceTransactionRoute(f.db,{...input,clientRequestId:'P6D-LOAN-FAILURE'},f.user);
  assert.notEqual(failed.status,200);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM finance_transactions').get() as any).n,2);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='FIN-BANK'").get() as any).n,60);
 }finally{f.db.close();}
});

test('6D deleting bank financing reverses the original bank once and rolls back on audit failure',async()=>{
 const f=fixture();
 try{
  const {deleteFinanceTransactionRoute}=await import('../server/modules/finance/service.ts');
  f.db.native.prepare("UPDATE bank_accounts SET current_balance=0 WHERE bank_account_id='FIN-BANK'").run();
  const posted=await addFinanceTransactionRoute(f.db,{
    personId:'LENDER-1',transactionType:'Loan Received',amount:60,paymentMethod:'Bank',bankAccountId:'FIN-BANK',
    clientRequestId:'P6D-LOAN-DELETE-01'
  },f.user);
  assert.equal(posted.status,200);
  const {id}=await posted.json() as {id:string};
  f.db.native.exec("CREATE TRIGGER fail_finance_reverse_audit BEFORE INSERT ON audit_logs WHEN NEW.action='FINANCE_REVERSE' BEGIN SELECT RAISE(ABORT,'audit broken'); END;");
  let failed:Response|undefined;
  try{failed=await deleteFinanceTransactionRoute(f.db,id,'Finance entry cancelled after review',f.user);}catch{}
  assert.notEqual(failed?.status,200);
  assert.equal((f.db.native.prepare('SELECT is_deleted n FROM finance_transactions WHERE finance_id=?').get(id) as any).n,0);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM bank_book WHERE reference=? AND is_deleted=0').get(id) as any).n,1);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='FIN-BANK'").get() as any).n,60);
  f.db.native.exec('DROP TRIGGER fail_finance_reverse_audit');
  const deleted=await deleteFinanceTransactionRoute(f.db,id,'Finance entry cancelled after review',f.user);
  assert.equal(deleted.status,200);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='FIN-BANK'").get() as any).n,0);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM bank_book WHERE reference=? AND is_deleted=0').get(id) as any).n,0);
  assert.equal((await read(f.db,'LENDER-1')).balance,0);
  assert.notEqual((await deleteFinanceTransactionRoute(f.db,id,'Duplicate delete',f.user)).status,200);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='FIN-BANK'").get() as any).n,0);
 }finally{f.db.close();}
});
test('6D finance edit moves the money leg between original bank and cash atomically',async()=>{
 const f=fixture();
 try{
  const {updateFinanceTransactionRoute}=await import('../server/modules/finance/service.ts');
  f.db.native.prepare("UPDATE bank_accounts SET current_balance=0 WHERE bank_account_id='FIN-BANK'").run();
  const first=await addFinanceTransactionRoute(f.db,{personId:'LENDER-1',transactionType:'Loan Received',
    amount:30,paymentMethod:'Bank',bankAccountId:'FIN-BANK',clientRequestId:'P6D-LOAN-EDIT-001'},f.user);
  assert.equal(first.status,200);
  const {id}=await first.json() as {id:string};
  f.db.native.exec("CREATE TRIGGER fail_finance_edited_cash BEFORE INSERT ON cash_book WHEN NEW.type='Loan Repayment' BEGIN SELECT RAISE(ABORT,'cash write failed'); END;");
  let failed:Response|undefined;
  const corrected={personId:'LENDER-1',transactionType:'Loan Repayment',amount:10,paymentMethod:'Cash',notes:'Original financing correction'};
  try{failed=await updateFinanceTransactionRoute(f.db,id,corrected,f.user);}catch{}
  assert.notEqual(failed?.status,200);
  assert.equal((f.db.native.prepare('SELECT transaction_type t FROM finance_transactions WHERE finance_id=?').get(id) as any).t,'Loan Received');
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='FIN-BANK'").get() as any).n,30);
  f.db.native.exec('DROP TRIGGER fail_finance_edited_cash');
  const updated=await updateFinanceTransactionRoute(f.db,id,corrected,f.user);
  assert.equal(updated.status,200);
  assert.equal((f.db.native.prepare("SELECT current_balance n FROM bank_accounts WHERE bank_account_id='FIN-BANK'").get() as any).n,0);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM bank_book WHERE reference=? AND is_deleted=0').get(id) as any).n,0);
  assert.equal((f.db.native.prepare('SELECT COUNT(*) n FROM cash_book WHERE reference=? AND is_deleted=0').get(id) as any).n,1);
  assert.equal((await read(f.db,'LENDER-1')).balance,-10);
 }finally{f.db.close();}
});
