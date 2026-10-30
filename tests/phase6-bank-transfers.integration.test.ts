import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

function fixture() {
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash) VALUES ('SESSION-P6B','Cashier',500)").run();
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES ('BANK-A','Bank A','Bank',100,100,'Active'),('BANK-B','Mobile B','Mobile Banking',25,25,'Active'),('BANK-C','Bank C','Bank',0,0,'Inactive')").run();
  db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('P6B-ADMIN','Test Admin','01000006688','fixture','fixture','admin','Active','Fixture')").run();
  const user={userId:'P6B-ADMIN',fullName:'Test Admin',role:'admin'} as any;
  const amounts=()=>db.native.prepare("SELECT bank_account_id,current_balance FROM bank_accounts ORDER BY bank_account_id").all() as any[];
  const legs=(id?:string)=>db.native.prepare("SELECT type,bank_account_id,debit,credit,reference FROM bank_book WHERE (? IS NULL OR reference=?) ORDER BY entry_id").all(id??null,id??null) as any[];
  const headers=()=>db.native.prepare("SELECT * FROM bank_transfers").all() as any[];
  return {db,user,amounts,legs,headers};
}
const input=(clientRequestId='P6B-REQUEST-00001',amount=30)=>({
  fromAccountId:'BANK-A',toAccountId:'BANK-B',amount,clientRequestId,notes:'stock float transfer'
});
async function post(db:SqliteDatabase,user:any,payload:ReturnType<typeof input>) {
  const {transferBankRoute}=await import('../server/modules/finance/service.ts');
  const response=await transferBankRoute(db,payload,user);
  return {status:response.status,...await response.json() as Record<string,any>};
}
async function reverse(db:SqliteDatabase,user:any,id:string,reason='Correction after review'){
  const {reverseBankTransferRoute}=await import('../server/modules/finance/service.ts');
  const response=await reverseBankTransferRoute(db,id,reason,user);
  return {status:response.status,...await response.json() as Record<string,any>};
}

test('6B transfer posts once with balanced bank and mobile ledger legs; same key retries safely',async()=>{
  const f=fixture();
  try {
    const first=await post(f.db,f.user,input());
    assert.equal(first.status,200,JSON.stringify(first));
    const next=await post(f.db,f.user,input());
    assert.equal(next.status,200,JSON.stringify(next));
    assert.equal(next.id,first.id,'same request key returns original transfer, never a second charge');
    assert.equal(f.headers().length,1);
    assert.deepEqual(f.amounts().map(x=>x.current_balance),[70,55,0]);
    assert.deepEqual(f.legs(first.id).map(x=>[x.type,x.debit,x.credit]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
      [['Transfer In',0,30],['Transfer Out',30,0]].sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    assert.equal((await post(f.db,f.user,{...input(),amount:31})).status,409,
      'same id with altered amount must not silently reuse original');
    assert.equal(f.headers().length,1);
    assert.equal(f.legs(first.id).length,2);
    assert.equal((await post(f.db,f.user,{...input(),clientRequestId:''})).status,400,
      'without idempotency key a network retry could double-charge');
  } finally {f.db.close();}
});

test('6B insufficient funds, inactive accounts, subprecision, wrong amount and same-account never mutate',async()=>{
  const f=fixture();
  try{
    const bad=[
      {...input('REQ-NOFUNDS-0001',101)},
      {...input('REQ-NEGATIVE-001',-10)},
      {...input('REQ-ZERO-00000001',0)},
      {...input('REQ-PRECISION01',0.00001)},
      {...input('REQ-INACTIVE-01'),toAccountId:'BANK-C'},
      {...input('REQ-SELF-0000001'),toAccountId:'BANK-A'},
      {...input('REQ-MISSING-001'),fromAccountId:'MISSING'}
    ];
    for(const req of bad){
      const r=await post(f.db,f.user,req);
      assert.notEqual(r.status,200,JSON.stringify({req,r}));
    }
    assert.equal(f.headers().length,0);
    assert.equal(f.legs().length,0);
    assert.deepEqual(f.amounts().map(x=>x.current_balance),[100,25,0]);
  }finally{f.db.close();}
});

test('6B concurrent distinct transfers cannot overdraft the same source account',async()=>{
  const f=fixture();
  try{
    const results=await Promise.all([
      post(f.db,f.user,input('P6B-CONCURRENT-01',80)),
      post(f.db,f.user,input('P6B-CONCURRENT-02',80))
    ]);
    assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));
    assert.equal(f.headers().length,1);
    assert.equal(f.legs().length,2);
    assert.deepEqual(f.amounts().map(x=>x.current_balance),[20,105,0]);
  }finally{f.db.close();}
});

test('6B forced failure on second ledger leg rolls back header, first leg and balance changes',async()=>{
  const f=fixture();
  try{
    f.db.native.exec("CREATE TRIGGER phase6_force_fail BEFORE INSERT ON bank_book WHEN NEW.type='Transfer In' BEGIN SELECT RAISE(ABORT,'simulated second-leg failure'); END;");
    const result=await post(f.db,f.user,input());
    assert.notEqual(result.status,200);
    assert.equal(f.headers().length,0);
    assert.equal(f.legs().length,0);
    assert.deepEqual(f.amounts().map(x=>x.current_balance),[100,25,0]);
  }finally{f.db.close();}
});

test('6B transfer must be reversed as a pair and cannot be reversed twice',async()=>{
  const f=fixture();
  try{
    const posted=await post(f.db,f.user,input());
    assert.equal(posted.status,200,JSON.stringify(posted));
    const single=f.db.native.prepare("SELECT entry_id FROM bank_book WHERE reference=? AND type='Transfer Out'").get(posted.id) as any;
    const {reverseBankEntryRoute}=await import('../server/modules/finance/service.ts');
    const singleRes=await reverseBankEntryRoute(f.db,single.entry_id,'Try half reversal',f.user);
    assert.notEqual(singleRes.status,200,'cannot reverse only one side of bank transfer');
    const reversed=await reverse(f.db,f.user,posted.id);
    assert.equal(reversed.status,200,JSON.stringify(reversed));
    assert.deepEqual(f.amounts().map(x=>x.current_balance),[100,25,0]);
    assert.equal(f.legs(posted.id).length,4,'original 2 and compensating 2');
    assert.equal(f.legs(posted.id).filter(x=>x.type.includes('Reversal')).length,2);
    const repeated=await reverse(f.db,f.user,posted.id);
    assert.notEqual(repeated.status,200);
    assert.equal(f.legs(posted.id).length,4);
    assert.equal(f.headers().length,1);
  }finally{f.db.close();}
});

test('6B reversal cannot overdraw destination when transferred funds have been spent',async()=>{
  const f=fixture();
  try{
    const posted=await post(f.db,f.user,input());
    assert.equal(posted.status,200);
    f.db.native.prepare("UPDATE bank_accounts SET current_balance=0 WHERE bank_account_id='BANK-B'").run();
    const reversed=await reverse(f.db,f.user,posted.id);
    assert.notEqual(reversed.status,200);
    assert.equal(f.legs(posted.id).length,2);
    assert.equal(f.headers()[0].reversed_at,'');
  }finally{f.db.close();}
});

test('6B cash-bank deposit failure never strands only one book leg',async()=>{
  const f=fixture();
  try{
    f.db.native.exec("CREATE TRIGGER fail_cash_contra BEFORE INSERT ON cash_book WHEN NEW.type='Cash Deposit' BEGIN SELECT RAISE(ABORT,'simulated cash failure'); END;");
    const {addBankManualEntryRoute}=await import('../server/modules/finance/service.ts');
    const res=await addBankManualEntryRoute(f.db,{bankAccountId:'BANK-A',entryType:'Cash Deposit',amount:10},f.user);
    assert.notEqual(res.status,200);
    assert.deepEqual(f.amounts().map(x=>x.current_balance),[100,25,0]);
    assert.equal(f.legs().length,0);
    assert.equal((f.db.native.prepare("SELECT count(*) n FROM cash_book").get() as any).n,0);
  }finally{f.db.close();}
});
