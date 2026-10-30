import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {
  addFinanceTransactionRoute, updateFinancePersonRoute, getFinancePersonLedgerRoute
} from '../server/modules/finance/service.ts';

function fixture(){
  const db=new SqliteDatabase(':memory:');runMigrations(db.native,resolve('migrations'));
  db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('FIDENT-ADMIN','Accountant','01000006519','fixture','fixture','admin','Active','Fixture')").run();
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash,status) VALUES('FIDENT-SESSION','Accountant',0,'Open')").run();
  db.native.prepare("INSERT INTO finance_persons(person_id,person_name,person_type) VALUES ('FIDENT-OWNER','Original Owner','Owner'),('FIDENT-LENDER','Original Lender','Lender')").run();
  return {db,user:{userId:'FIDENT-ADMIN',fullName:'Accountant',role:'admin'} as any,
    record:(personId:string)=>db.native.prepare('SELECT * FROM finance_persons WHERE person_id=?').get(personId) as any,
    entries:(personId:string)=>db.native.prepare('SELECT * FROM finance_transactions WHERE person_id=? ORDER BY finance_id').all(personId) as any[]};
}
async function payload(res:Response){return {status:res.status,...await res.json() as Record<string,any>};}

test('6I posted owner cannot become lender; owner and lender balances remain auditable',async()=>{
 const f=fixture();
 try{
  const post=await payload(await addFinanceTransactionRoute(f.db,{
    personId:'FIDENT-OWNER',transactionType:'Owner Investment',paymentMethod:'Cash',amount:125.25,
    clientRequestId:'FIDENT-OWNER-POST-01'
  },f.user));
  assert.equal(post.status,200,JSON.stringify(post));
  const before=await payload(await getFinancePersonLedgerRoute(f.db,'FIDENT-OWNER',new URL('https://test.invalid/?pageSize=50')));
  assert.equal(before.coverage.status,'ready');
  assert.equal(before.balance,125.25);
  const changed=await payload(await updateFinancePersonRoute(f.db,'FIDENT-OWNER',{
    name:'Original Owner',personType:'Lender',phone:'01700000000'
  }));
  assert.equal(changed.status,409,'historical owner capital cannot be recategorized as a lender');
  assert.equal(f.record('FIDENT-OWNER').person_type,'Owner');
  assert.equal(f.entries('FIDENT-OWNER').length,1);
  assert.equal((await payload(await getFinancePersonLedgerRoute(f.db,'FIDENT-OWNER',new URL('https://test.invalid/')))).balance,125.25);
  assert.equal((await payload(await getFinancePersonLedgerRoute(f.db,'FIDENT-LENDER',new URL('https://test.invalid/')))).balance,0);
 }finally{f.db.close();}
});

test('6I renaming a person does not rewrite historical finance transaction identity',async()=>{
 const f=fixture();
 try{
  assert.equal((await addFinanceTransactionRoute(f.db,{
    personId:'FIDENT-LENDER',transactionType:'Loan Received',paymentMethod:'Cash',amount:70,
    clientRequestId:'FIDENT-LENDER-POST1'
  },f.user)).status,200);
  const original=f.entries('FIDENT-LENDER')[0];
  assert.equal(original.person_name,'Original Lender');
  const rename=await payload(await updateFinancePersonRoute(f.db,'FIDENT-LENDER',{
    name:'Lender Updated Name',personType:'Lender',phone:'01800000000'
  }));
  assert.equal(rename.status,200,JSON.stringify(rename));
  assert.equal(f.record('FIDENT-LENDER').person_name,'Lender Updated Name');
  assert.equal(f.entries('FIDENT-LENDER')[0].person_name,'Original Lender',
    'original posting attribution remains unchanged for audit');
  const ledger=await payload(await getFinancePersonLedgerRoute(f.db,'FIDENT-LENDER',new URL('https://test.invalid/')));
  assert.equal(ledger.coverage.status,'ready');
  assert.equal(ledger.person.name,'Lender Updated Name');
  assert.equal(ledger.balance,70);
 }finally{f.db.close();}
});

test('6I historical classification is immutable even for direct SQL and cancelled finance transactions',async()=>{
 const f=fixture();
 try{
  assert.equal((await addFinanceTransactionRoute(f.db,{
    personId:'FIDENT-OWNER',transactionType:'Owner Investment',paymentMethod:'Cash',amount:1,
    clientRequestId:'FIDENT-OWNER-POST-02'
  },f.user)).status,200);
  f.db.native.prepare("UPDATE finance_transactions SET is_deleted=1 WHERE person_id='FIDENT-OWNER'").run();
  assert.throws(()=>f.db.native.prepare(
    "UPDATE finance_persons SET person_type='Lender' WHERE person_id='FIDENT-OWNER'"
  ).run(),/finance person type|history|cannot change/i);
  assert.equal(f.record('FIDENT-OWNER').person_type,'Owner');
  f.db.native.prepare("UPDATE finance_persons SET person_type='Owner' WHERE person_id='FIDENT-OWNER'").run();
  f.db.native.prepare("UPDATE finance_persons SET person_type='Owner' WHERE person_id='FIDENT-LENDER'").run();
  assert.equal(f.record('FIDENT-LENDER').person_type,'Owner',
    'type can change only before the first historical posting');
 }finally{f.db.close();}
});
