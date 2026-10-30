import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {startCashSessionRoute,closeCashSessionRoute,getCashSessionSummaryRoute} from '../server/modules/sales/service.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const cashier={userId:'P6C-CASHIER',fullName:'Cashier',role:'admin'} as any;
function fixture(){
 const db=new SqliteDatabase(':memory:');
 runMigrations(db.native,resolve('migrations'));
 db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('P6C-CASHIER','Cashier','01000006777','fixture','fixture','admin','Active','Fixture')").run();
 const sessions=()=>db.native.prepare('SELECT * FROM cash_sessions ORDER BY opened_at,session_id').all() as any[];
 const book=()=>db.native.prepare('SELECT * FROM cash_book ORDER BY rowid').all() as any[];
 const audit=()=>db.native.prepare("SELECT * FROM audit_logs WHERE entity_type='CASH_SESSION'").all() as any[];
 const post=(type:string,debit:number,credit:number,isDeleted=0)=>db.native.prepare('INSERT INTO cash_book(entry_id,date,type,reference,debit,credit,is_deleted) VALUES (?,?,?,?,?,?,?)').run('CB-'+crypto.randomUUID(),'2026-10-30',type,'FIXTURE',debit,credit,isDeleted);
 return {db,sessions,book,audit,post};
}
async function payload(res:Response){return {status:res.status,...await res.json() as Record<string,any>};}

test('6C start is idempotent and cannot create two active sessions or second opening cash receipt',async()=>{
 const f=fixture();
 try {
  const input={openingCash:100.25,notes:'Counter day opening',clientRequestId:'P6C-START-00001'};
  const first=await payload(await startCashSessionRoute(f.db,input,cashier));
  assert.equal(first.status,200,JSON.stringify(first));
  const retry=await payload(await startCashSessionRoute(f.db,input,cashier));
  assert.equal(retry.status,200,JSON.stringify(retry));
  assert.equal(retry.sessionId,first.sessionId);
  assert.equal(f.sessions().length,1);
  assert.equal(f.book().length,1);
  const conflict=await payload(await startCashSessionRoute(f.db,{...input,openingCash:120},cashier));
  assert.equal(conflict.status,409);
  const concurrent=await Promise.all([
    startCashSessionRoute(f.db,{openingCash:10,clientRequestId:'P6C-START-OTHER1'},cashier),
    startCashSessionRoute(f.db,{openingCash:10,clientRequestId:'P6C-START-OTHER2'},cashier)
  ]);
  assert.ok(concurrent.every(x=>x.status!==200));
  assert.equal(f.book().length,1);
  assert.equal((await payload(await getCashSessionSummaryRoute(f.db))).summary.cashIn,0,
    'opening float is not earned receipt');
  assert.equal((await payload(await getCashSessionSummaryRoute(f.db))).summary.expectedCash,100.25);
 }finally{f.db.close();}
});

test('6C session summary counts only live posted cash movements after session start; opening and bank are excluded',async()=>{
 const f=fixture();
 try {
  f.post('Sale',0,300);
  const started=await payload(await startCashSessionRoute(f.db,{openingCash:100,clientRequestId:'P6C-START-00002'},cashier));
  assert.equal(started.status,200);
  f.post('Sale',0,230);
  f.post('Sales Return',50,0);
  f.post('Cash Deposit',20,0);
  f.post('Deleted cash event',0,900,1);
  const r=await payload(await getCashSessionSummaryRoute(f.db));
  assert.equal(r.status,200);
  assert.equal(r.summary.openingCash,100);
  assert.equal(r.summary.cashIn,230);
  assert.equal(r.summary.cashOut,70);
  assert.equal(r.summary.expectedCash,260);
 }finally{f.db.close();}
});

test('6C close stores counted vs expected and variance but never posts a fictitious cash-book adjustment',async()=>{
 const f=fixture();
 try{
  const started=await payload(await startCashSessionRoute(f.db,{openingCash:100,clientRequestId:'P6C-START-00003'},cashier));
  assert.equal(started.status,200);
  f.post('Sale',0,50);
  f.post('Expense',25,0);
  const oldCount=f.book().length;
  const closeInput={countedCash:130,notes:'Cash count discrepancy reviewed',clientRequestId:'P6C-CLOSE-00003'};
  const closed=await payload(await closeCashSessionRoute(f.db,closeInput,cashier));
  assert.equal(closed.status,200,JSON.stringify(closed));
  assert.equal(closed.expected,125);
  assert.equal(closed.counted,130);
  assert.equal(closed.variance,5);
  assert.equal(f.book().length,oldCount,'variance is NOT a cash transaction');
  assert.equal(f.sessions()[0].status,'Closed');
  assert.equal(f.sessions()[0].expected_cash,125);
  assert.equal(f.sessions()[0].variance,5);
  assert.equal(f.sessions()[0].closed_by,'P6C-CASHIER');
  assert.ok(f.sessions()[0].closed_at);
  assert.equal(f.audit().filter(x=>x.action==='CLOSE_CASH_SESSION').length,1);
  const same=await payload(await closeCashSessionRoute(f.db,closeInput,cashier));
  assert.equal(same.status,200);
  assert.equal(same.replayed,true);
  assert.equal(f.audit().filter(x=>x.action==='CLOSE_CASH_SESSION').length,1);
  assert.equal((await payload(await closeCashSessionRoute(f.db,{...closeInput,countedCash:120},cashier))).status,409);
  assert.equal((await payload(await getCashSessionSummaryRoute(f.db))).summary,null);
 }finally{f.db.close();}
});

test('6C variance cannot close without an accountable explanation',async()=>{
 const f=fixture();
 try{
  await startCashSessionRoute(f.db,{openingCash:100,clientRequestId:'P6C-START-00004'},cashier);
  for(const notes of ['', 'short']){
   const result=await payload(await closeCashSessionRoute(f.db,{countedCash:90,notes,clientRequestId:'P6C-CLOSE-00004'},cashier));
   assert.notEqual(result.status,200);
   assert.equal(f.sessions()[0].status,'Open');
  }
  const success=await payload(await closeCashSessionRoute(f.db,{countedCash:100,notes:'',clientRequestId:'P6C-CLOSE-00005'},cashier));
  assert.equal(success.status,200,'zero variance needs no explanation');
 }finally{f.db.close();}
});

test('6C concurrent close and failed audit write are atomic; never leave a partly closed cash session',async()=>{
 const f=fixture();
 try{
  await startCashSessionRoute(f.db,{openingCash:100,clientRequestId:'P6C-START-00005'},cashier);
  const same=await Promise.all([
   closeCashSessionRoute(f.db,{countedCash:100,clientRequestId:'P6C-CLOSE-00005'},cashier),
   closeCashSessionRoute(f.db,{countedCash:100,clientRequestId:'P6C-CLOSE-00006'},cashier)
  ]);
  assert.equal(same.filter(x=>x.status===200).length,1);
  assert.equal(f.audit().length,1);
  await startCashSessionRoute(f.db,{openingCash:120,clientRequestId:'P6C-START-00006'},cashier);
  f.db.native.exec("CREATE TRIGGER phase6c_fail_audit BEFORE INSERT ON audit_logs WHEN NEW.action='CLOSE_CASH_SESSION' BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
  const failed=await payload(await closeCashSessionRoute(f.db,{countedCash:120,clientRequestId:'P6C-CLOSE-00007'},cashier));
  assert.notEqual(failed.status,200);
  assert.equal(f.sessions().at(-1)?.status,'Open');
  assert.equal(f.audit().length,1);
 }finally{f.db.close();}
});

test('6C opening/closing cash requires POS permission, and variance requires pos.edit',async()=>{
 const f=fixture();
 try{
  const token='staff-pos-session-6c';
  const {createHash}=await import('node:crypto');
  const hash=createHash('sha256').update(token).digest('base64');
  f.db.native.prepare("INSERT INTO app_roles(role_name,permissions_json) VALUES ('p6c-cashier',?)")
    .run(JSON.stringify({pos:{view:true,add:true,edit:false}}));
  f.db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('P6C-STAFF','Staff','01000006778','fixture','fixture','p6c-cashier','Active','Fixture')").run();
  f.db.native.prepare("INSERT INTO auth_sessions(session_id,user_id,token_hash,expires_at) VALUES ('P6C-AUTH','P6C-STAFF',?,datetime('now','+2 hours'))").run(hash);
  const req=async(path:string,body:unknown,auth=token)=>{
   const res=await handleApiRequest(new Request('https://isolated.test'+path,{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth},body:JSON.stringify(body)
   }),f.db);
   return payload(res);
  };
  assert.equal((await req('/api/pos/cash-session/start',{openingCash:50,clientRequestId:'P6C-START-STAFF'} ,'anonymous')).status,401);
  const opened=await req('/api/pos/cash-session/start',{openingCash:50,clientRequestId:'P6C-START-STAFF'});
  assert.equal(opened.status,200,JSON.stringify(opened));
  const denied=await req('/api/pos/cash-session/close',{countedCash:45,notes:'Cash discrepancy recorded',clientRequestId:'P6C-CLOSE-STAFF'});
  assert.equal(denied.status,403);
  assert.equal(f.sessions()[0].status,'Open');
  const clean=await req('/api/pos/cash-session/close',{countedCash:50,clientRequestId:'P6C-CLOSE-STAFF2'});
  assert.equal(clean.status,200,JSON.stringify(clean));
 }finally{f.db.close();}
});
