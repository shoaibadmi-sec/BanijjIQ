import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {buildDemoSeedPlan,executeDemoSeed} from '../scripts/preview/demo-seed-plan.mjs';

const today=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(name:string)=>parts.find(p=>p.type===name)?.value||'';
  return part('year')+'-'+part('month')+'-'+part('day');
};
const endpoint=(to:string)=>'/api/reports/v2/dashboard-cashflow?to='+to;
test('cashflow monthly chart API: real source-derived cash and bank flows, no internal/float double-counting, RBAC, tamper fail closed',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const call=async(method:string,path:string,body?:unknown)=>{
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const res=await handleApiRequest(new Request('https://local.test'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:res.status,...(await res.json()) as Record<string,any>};
  };
  assert.equal((await call('GET',endpoint(today()))).status,401);
  const admin=await call('POST','/api/setup/admin',{fullName:'Preview Report Admin',phone:'01000000188',password:'local-isolated-test-only'});
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const result=await executeDemoSeed(call,buildDemoSeedPlan());
  assert.deepEqual([result.products,result.sales,result.purchases,result.expenses],[13,2,1,1]);
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  const r=await call('GET',endpoint(today()));
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.ok,true);
  assert.equal(r.points.length,6);
  assert.deepEqual(r.points.map((p:any)=>p.month).slice(-1),[today().slice(0,7)]);
  assert.equal(r.points[5].inMinor,184000); // posted cash sale, excludes initial cash float
  assert.equal(r.points[5].outMinor,7500000); // bank purchase 40000 + bank rent 35000
  assert.equal(r.points[5].status,'needs-review','current verified books are not full audited P&L');
  assert.equal(r.points.slice(0,5).every((p:any)=>p.inMinor===0&&p.outMinor===0),true);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,'report cannot mutate D1');
  const bankAccounts=db.native.prepare("SELECT bank_account_id id FROM bank_accounts WHERE account_name LIKE '[DEMO]%' ORDER BY account_name").all() as Array<{id:string}>;
  assert.equal(bankAccounts.length,4);
  const transfer=await call('POST','/api/bank/transfers',{
    fromAccountId:bankAccounts[0].id,toAccountId:bankAccounts[1].id,amount:123.45,
    notes:'Internal transfer must not inflate monthly cashflow'
  });
  assert.equal(transfer.status,200,JSON.stringify(transfer));
  const afterTransfer=await call('GET',endpoint(today()));
  assert.equal(afterTransfer.status,200,JSON.stringify(afterTransfer));
  assert.deepEqual(afterTransfer.points,r.points,'balanced treasury transfer cannot increase cash in/out');
  assert.equal((await call('GET',endpoint('2026-02-30'))).status,400);
  assert.equal((await call('GET',endpoint('2026-10-30')+'&from=1900-01-01')).status,400,'unaccepted query fields fail closed');
  const tokenFromAdmin=token, viewerToken='monthly-chart-limited-test-token';
  const tokenHash=createHash('sha256').update(viewerToken).digest('base64');
  db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('cashflow-denied','No Reports','01000000189','x','x','restricted-reports','Active','Fixture')").run();
  db.native.prepare("INSERT INTO auth_sessions(session_id,user_id,token_hash,expires_at) VALUES ('cashflow-denied-session','cashflow-denied',?,datetime('now','+2 hours'))").run(tokenHash);
  token=viewerToken;assert.equal((await call('GET',endpoint(today()))).status,403);token=tokenFromAdmin;
  // An unsupported sub-poisha movement cannot silently round to zero in a business chart.
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit) VALUES ('SUBPOISHA-CHART',?,'External','SOURCE','fractional poisha',0.001,0)").run(today());
  const fractional=await call('GET',endpoint(today()));
  assert.ok(fractional.points.every((p:any)=>p.status==='incomplete'&&p.inMinor===null&&p.outMinor===null));
  db.native.prepare("DELETE FROM cash_book WHERE entry_id='SUBPOISHA-CHART'").run();
  // An invalid money-book posting invalidates the entire series, never renders a fabricated 0.
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit) VALUES ('BAD-CHART',?,'Expense','NONEXISTENT','invalid ledger','100','100')").run(today());
  const corrupted=await call('GET',endpoint(today()));
  assert.equal(corrupted.status,200);
  assert.ok(corrupted.points.every((p:any)=>p.status==='incomplete'&&p.inMinor===null&&p.outMinor===null));
 }finally{db.close();}
});