// Dedicated destructive-to-fixture-only accounting test. Never contacts remote D1.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(process.cwd());
const cfg=join(root,'wrangler.d1-ci.jsonc');
const fixture=JSON.parse(readFileSync(cfg,'utf8'));
const production=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
assert.notEqual(fixture.d1_databases[0].database_id,production.d1_databases[0].database_id);
assert.equal(fixture.d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
const pkg=JSON.parse(readFileSync(join(root,'node_modules/wrangler/package.json'),'utf8'));
const wrangler=join(root,'node_modules/wrangler',typeof pkg.bin==='string'?pkg.bin:pkg.bin.wrangler);
const state=mkdtempSync(join(tmpdir(),'hisabiq-historical-credit-ci-'));
const port=8796,base='http://127.0.0.1:'+port,secret='ISOLATED-CREDIT-TEST-ONLY';
let worker,logs='';
function cli(args){
  const p=spawnSync(process.execPath,[wrangler,...args,'--config',cfg],{
    cwd:root,encoding:'utf8',timeout:120000,
    env:{...process.env,CI:'true',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_API_TOKEN:''}
  });
  if(p.status!==0)throw new Error((p.stderr||p.stdout||'D1 command error').slice(-1800));
  return p.stdout;
}
function sql(statement){
  const stdout=cli(['d1','execute','DB','--local','--persist-to',state,'--json','--command',statement]);
  const at=stdout.indexOf('[');
  if(at<0)throw new Error(stdout.slice(-500));
  return JSON.parse(stdout.slice(at))[0]?.results||[];
}
async function api(method,path,body,token=''){
  const res=await fetch(base+path,{
    method,headers:{'content-type':'application/json',
      ...(token?{authorization:'Bearer '+token}:{}),
      ...(!token&&path==='/api/setup/admin'?{'x-setup-secret':secret}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(15000)
  });
  return {status:res.status,...await res.json()};
}
async function stop(){
  if(!worker||worker.exitCode!==null)return;
  worker.kill('SIGTERM');
  await Promise.race([new Promise(done=>worker.once('exit',done)),
    new Promise(done=>setTimeout(done,6000))]);
  if(worker.exitCode===null)worker.kill('SIGKILL');
}
try{
  cli(['d1','migrations','apply','DB','--local','--persist-to',state]);
  // Seed only when the Worker is stopped. Wrangler CLI and a running Worker
  // must never be used simultaneously against the same persistence directory.
  const fixtureSql=[
    "INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('RC-CUS','Reclass Customer','01000008919',-10,'Active',0)",
    "INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) VALUES ('RC-SALE','2026-10-30','RC-CUS','Reclass Customer','01000008919',50,50,0,'Cash','Paid','Cash')",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('RC-CASH','2026-10-30','Sale','RC-SALE','Original paid cash',0,50,'Cash',0)",
    "INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('RC-SALE','P','Switch',5,10,50)",
    "INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('RC-RETURN','2026-10-30','RC-SALE','RC-CUS','Reclass Customer','01000008919','Store Credit',10,'Old credit used as due')",
    "INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES ('RC-RETURN','RC-SALE','P','Switch',1,10,10)",
    "INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) VALUES ('RC-LEDGER','2026-10-30','RC-CUS','Reclass Customer','Sales Return Credit','RC-RETURN',0,10,-10,'Historical due offset')",
    "INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('D1-SPLIT-CUS','Split Buyer','01000008111',0,'Active',0)",
    "INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) VALUES ('D1-SPLIT-ORIGINAL','2026-10-30','D1-SPLIT-CUS','Split Buyer','01000008111',40,40,0,'Cash','Paid','Cash')",
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('D1-SPLIT-CASH','2026-10-30','Sale','D1-SPLIT-ORIGINAL','Original paid cash',0,40,'Cash',0)",
    "INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('D1-SPLIT-ORIGINAL','WIRE-1','Wire',4,10,40)",
    "INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('D1-SPLIT-RETURN','2026-10-30','D1-SPLIT-ORIGINAL','D1-SPLIT-CUS','Split Buyer','01000008111','Store Credit',30,'Verified split balance')",
    "INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES ('D1-SPLIT-RETURN','D1-SPLIT-ORIGINAL','WIRE-1','Wire',3,10,30)",
    "INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) VALUES ('D1-SPLIT-ISSUE','D1-SPLIT-CUS','ISSUE','Sales Return','D1-SPLIT-RETURN',3000,3000,'tester')"
  ];
  for(const stmt of fixtureSql)sql(stmt);
  worker=spawn(process.execPath,[wrangler,'dev','--config',cfg,'--local','--persist-to',state,
    '--ip','127.0.0.1','--port',String(port),'--var','SETUP_SECRET:'+secret],{
    cwd:root,stdio:['ignore','pipe','pipe'],
    env:{...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}
  });
  for(const stream of [worker.stdout,worker.stderr])stream.on('data',b=>{logs=(logs+String(b)).slice(-15000);});
  let ready=false;
  for(let i=0;i<90;i++){
    if(worker.exitCode!==null)throw new Error('Worker exited early: '+logs.slice(-1500));
    try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1200)})).ok){ready=true;break;}}
    catch{}
    await new Promise(done=>setTimeout(done,300));
  }
  assert.equal(ready,true,'Worker startup: '+logs.slice(-1500));
  const signup=await api('POST','/api/setup/admin',{
    fullName:'Reclassification Reviewer',phone:'01000008920',password:'IsolatedTestStrong2026!'
  });
  assert.equal(signup.ok,true,JSON.stringify(signup));const token=signup.token;
  const cases=await api('GET','/api/pos/store-credit/reconciliation/cases',undefined,token);
  assert.equal(cases.ok,true,JSON.stringify(cases));
  const candidate=cases.cases.find(c=>c.flagCode==='LEGACY_UNJOURNALED_RETURN'&&c.referenceId==='RC-RETURN');
  assert.ok(candidate,JSON.stringify(cases));
  const path='/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(candidate.caseId);
  const impact=await api('GET',path+'/impact',undefined,token);
  assert.equal(impact.eligible,true,JSON.stringify(impact));
  const decision={decision:'verified-outstanding',expectedVersion:1,
    reason:'Verified old negative due converted once into historical liability',
    evidenceIds:impact.sourceIds};
  const posted=await api('POST',path+'/resolve',decision,token);
  assert.equal(posted.status,200,JSON.stringify(posted));
  assert.equal(posted.creditIssuedCents,1000);
  assert.equal((await api('POST',path+'/resolve',decision,token)).status,409);
  const account=await api('GET','/api/pos/store-credit/RC-CUS',undefined,token);
  assert.equal(account.availableCents,1000,JSON.stringify(account));
  assert.equal(account.due,0);
  const session=await api('POST','/api/pos/cash-session/start',{openingCash:0},token);
  assert.equal(session.ok,true,JSON.stringify(session));
  const wire=await api('POST','/api/products',{
    productName:'Split D1 Cable',category:'Electrical',unit:'Pcs',
    purchasePrice:5,sellingPrice:10,currentStock:8,minimumStock:0,status:'Active'
  },token);
  assert.equal(wire.ok,true,JSON.stringify(wire));
  const splitInput={
    clientRequestId:'d1-split-credit-source-0001',
    customerId:'D1-SPLIT-CUS',customerName:'Split Buyer',customerPhone:'01000008111',
    paymentType:'Cash',paymentMethod:'Cash',
    tenders:[{method:'Cash',amountCents:2000},{method:'Store Credit',amountCents:3000}],
    items:[{productId:wire.productId,qty:5,unitPrice:10}]
  };
  const mixed=await api('POST','/api/pos/sales',splitInput,token);
  assert.equal(mixed.ok,true,JSON.stringify(mixed));
  assert.equal(mixed.invoice.paymentMethod,'Split');
  assert.equal(mixed.invoice.dueAmount,0);
  assert.equal(mixed.invoice.paymentAllocations.length,2);
  const replay=await api('POST','/api/pos/sales',splitInput,token);
  assert.equal(replay.invoice.invoiceId,mixed.invoice.invoiceId);
  assert.equal((await api('POST','/api/pos/sales',{
    ...splitInput,tenders:[{method:'Cash',amountCents:2001},{method:'Store Credit',amountCents:2999}]
  },token)).status,409);
  const remaining=await api('GET','/api/pos/store-credit/D1-SPLIT-CUS',undefined,token);
  assert.equal(remaining.availableCents,0,JSON.stringify(remaining));
  await stop();
  const sid=mixed.invoice.invoiceId.replace(/'/g,'');
  assert.equal(sql("SELECT COUNT(*) n FROM sale_tender_allocations WHERE invoice_id='"+sid+"'")[0].n,2);
  assert.equal(sql("SELECT SUM(amount_cents) n FROM sale_tender_allocations WHERE invoice_id='"+sid+"'")[0].n,5000);
  assert.equal(sql("SELECT SUM(credit) n FROM cash_book WHERE reference='"+sid+"'")[0].n,20);
  assert.equal(sql("SELECT SUM(delta_cents) n FROM customer_store_credit_entries WHERE customer_id='D1-SPLIT-CUS'")[0].n,0);
  assert.equal(sql("SELECT current_stock n FROM products WHERE product_id='"+wire.productId+"'")[0].n,3);
  assert.equal(sql("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE_SALE' AND entity_id='"+sid+"'")[0].n,1);
  assert.equal(sql("SELECT current_due due FROM customers WHERE customer_id='RC-CUS'")[0].due,0);
  assert.equal(sql('SELECT COUNT(*) n FROM store_credit_historical_adjustments')[0].n,1);
  assert.equal(sql("SELECT COUNT(*) n FROM customer_ledger WHERE type='Store Credit Reclassification'")[0].n,1);
  assert.equal(sql("SELECT COUNT(*) n FROM audit_logs WHERE action='RECONCILE_STORE_CREDIT'")[0].n,1);
  assert.equal(sql("SELECT COUNT(*) n FROM cash_book WHERE reference IN ('RC-SALE','D1-SPLIT-ORIGINAL','"+sid+"')")[0].n,3);
  assert.equal(sql('SELECT COUNT(*) n FROM bank_book')[0].n,0);
  process.stdout.write('PASS historical credit plus split cash-credit posting on isolated Worker/D1\n');
}catch(err){
  process.stderr.write('FAIL isolated Worker/D1 historical credit reclassification: '+String(err)+'\n'+logs.slice(-2200)+'\n');
  process.exitCode=1;
}finally{
  await stop();
  rmSync(state,{recursive:true,force:true});
}
