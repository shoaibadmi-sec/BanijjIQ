/**
 * No credentials and no remote D1: all requests hit a fresh Wrangler --local
 * Worker + D1 fixture. The config cannot address production D1.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runRealD1Browser } from './browser.mjs';

const base='http://127.0.0.1:8788';
const root=resolve(process.cwd());
const config=join(root,'wrangler.d1-ci.jsonc');
const fixture=JSON.parse(readFileSync(config,'utf8'));
const production=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
assert.notEqual(fixture.name,production.name);
assert.notEqual(fixture.d1_databases[0].database_id,production.d1_databases[0].database_id);
assert.equal(fixture.d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
const pkg=JSON.parse(readFileSync(join(root,'node_modules/wrangler/package.json'),'utf8'));
const cliPath=join(root,'node_modules/wrangler',
  typeof pkg.bin==='string'?pkg.bin:pkg.bin.wrangler);
const setupSecret='LOCAL-CI-ONLY-NOT-A-PRODUCTION-SECRET';
const state=mkdtempSync(join(tmpdir(),'banijjiq-d1-ci-'));
const out=join(root,'d1-checks/output');
mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),passed:[],failed:[],requests:[],
  source:'Wrangler local Worker + isolated D1; no remote bindings',dbName:fixture.d1_databases[0].database_name};
let logs='';
let worker;

function wrangler(args,{json=false}={}){
  // Never change any of these flags; Wrangler defaults are NOT safe for isolation.
  assert.ok(args.some(x=>x==='--local'),'D1 command must be --local');
  assert.ok(args.includes('--persist-to'),'D1 command must have isolated persistence');
  assert.ok(!args.includes('--remote'),'Remote D1 forbidden in CI');
  const result=spawnSync(process.execPath,[cliPath,...args,'--config',config],
    {cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('Local Wrangler failed: '+(result.stderr||result.stdout).slice(-8000));
  return result.stdout;
}
function query(sql){
  const stdout=wrangler(['d1','execute','DB','--local','--persist-to',state,
    '--json','--command',sql]);
  // Wrangler may include CLI status before a JSON array; find first '['.
  const start=stdout.indexOf('[');
  if(start<0)throw new Error('Expected Wrangler JSON result; got '+stdout.slice(-1200));
  const parsed=JSON.parse(stdout.slice(start));
  return parsed[0]?.results||[];
}
async function request(method,path,body,opts={}){
  const headers={'content-type':'application/json',...(opts.token?{authorization:'Bearer '+opts.token}:{}),
    ...(opts.setupSecret?{'x-setup-secret':setupSecret}:{})};
  const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(16000)});
  const text=await res.text();
  let result;
  try{result=JSON.parse(text);}catch{throw new Error('Invalid JSON from '+path+' status '+res.status+': '+text.slice(0,250));}
  report.requests.push({method,path,status:res.status});
  return {status:res.status,...result};
}
async function check(name,fn){
  try{await fn();report.passed.push(name);process.stdout.write('PASS '+name+'\n');}
  catch(err){report.failed.push({name,message:String(err?.stack||err)});process.stderr.write('FAIL '+name+': '+err+'\n');
    throw err;}
}
async function waitForServer(){
  for(let i=0;i<100;i++){
    if(worker.exitCode!==null)throw new Error('Worker exited early ('+worker.exitCode+'): '+logs.slice(-3000));
    try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});if(response.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,350));
  }
  throw new Error('Local Worker never started: '+logs.slice(-5000));
}
const product={
  productName:'D1 CI Copper Wire',brand:'E2E Brand',category:'Electrical',
  unit:'Pcs',barcode:'D1-CI-001',purchasePrice:60,sellingPrice:100,
  currentStock:9,minimumStock:2,status:'Active',
  trackSerial:false,trackExpiry:false,trackWarranty:false
};
let token='',productId='',paidInvoice='',partialInvoice='';
try{
  await check('local D1 runs every SQL migration',async()=>{
    const out=wrangler(['d1','migrations','apply','DB','--local','--persist-to',state]);
    assert.match(out,/0028_pos_sale_idempotency|pos_sale_idempotency/);
    assert.ok(query("SELECT name FROM sqlite_master WHERE type='table' AND name='pos_sale_requests'").length);
    assert.ok(query("SELECT name FROM sqlite_master WHERE type='table' AND name='sales'").length);
  });
  worker=spawn(process.execPath,[cliPath,'dev',
    '--config',config,'--local','--persist-to',state,
    '--ip','127.0.0.1','--port','8788',
    '--var','SETUP_SECRET:'+setupSecret],{
    cwd:root,stdio:['ignore','pipe','pipe'],
    env:{...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}
  });
  for(const stream of [worker.stdout,worker.stderr])
    stream.on('data',chunk=>{logs=(logs+String(chunk)).slice(-24000);});
  await waitForServer();

  await check('real Hono Worker blocks unauthorized actions and setup hijack',async()=>{
    const noAuth=await request('GET','/api/pos/bootstrap');
    assert.equal(noAuth.status,401);
    const denied=await request('POST','/api/setup/admin',{
      fullName:'Test Admin',phone:'01000000444',password:'Local-Only-Test!'
    });
    assert.equal(denied.status,403);
    const setup=await request('POST','/api/setup/admin',{
      fullName:'Test Admin',phone:'01000000444',password:'Local-Only-Test!'
    },{setupSecret:true});
    assert.equal(setup.ok,true,JSON.stringify(setup));
    assert.ok(setup.token);
    token=setup.token;
    assert.equal((await request('GET','/api/auth/me',undefined,{token})).user.fullName,'Test Admin');
  });
  await check('real Worker creates product and opening FIFO inventory',async()=>{
    const added=await request('POST','/api/products',product,{token});
    assert.equal(added.ok,true,JSON.stringify(added));
    productId=added.productId;
    const boot=await request('GET','/api/bootstrap',undefined,{token});
    const p=boot.products.find(x=>x.productId===productId);
    assert.equal(Number(p.currentStock),9);
    const pos=await request('GET','/api/pos/bootstrap',undefined,{token});
    assert.equal(Number(pos.products.find(x=>x.id===productId).stock),9);
  });
  await check('cannot sell before session, then opens one valid session',async()=>{
    const payload={clientRequestId:'d1-ci-closed-session-001',
      customerName:'No Session Buyer',customerPhone:'01000000555',
      discount:0,paymentType:'Cash',paidAmount:0,paymentMethod:'Cash',
      items:[{productId,name:'D1 CI Copper Wire',qty:1,unitPrice:100,fulfillmentMode:'own'}]};
    assert.equal((await request('POST','/api/pos/sales',payload,{token})).ok,false);
    const session=await request('POST','/api/pos/cash-session/start',{openingCash:300},{token});
    assert.equal(session.ok,true,JSON.stringify(session));
    assert.equal((await request('POST','/api/pos/cash-session/start',{openingCash:300},{token})).ok,false);
  });
  const sale=(key,qty,paymentType,paidAmount,phone)=>({
    clientRequestId:key,customerName:'D1 Test Customer',customerPhone:phone,
    discount:0,paymentType,paidAmount,paymentMethod:'Cash',
    items:[{productId,name:'D1 CI Copper Wire',qty,unitPrice:100,fulfillmentMode:'own'}]
  });
  const paid=sale('d1-ci-cash-sale-00001',2,'Cash',0,'01000000666');
  await check('cash sale commits invoice/receipt and deducted stock',async()=>{
    const r=await request('POST','/api/pos/sales',paid,{token});
    assert.equal(r.ok,true,JSON.stringify(r));
    paidInvoice=r.invoice.invoiceId;
    assert.equal(r.invoice.grandTotal,200);
    assert.equal(r.invoice.paidAmount,200);
    const invoice=await request('GET','/api/pos/invoices/'+encodeURIComponent(paidInvoice),undefined,{token});
    assert.equal(invoice.invoice.items[0].quantity,2);
    const bootstrap=await request('GET','/api/bootstrap',undefined,{token});
    assert.equal(Number(bootstrap.products.find(p=>p.productId===productId).currentStock),7);
  });
  await check('replayed key returns original invoice; mismatch returns HTTP 409',async()=>{
    const replay=await request('POST','/api/pos/sales',paid,{token});
    assert.equal(replay.invoice.invoiceId,paidInvoice);
    const mismatch=await request('POST','/api/pos/sales',{...paid,discount:1},{token});
    assert.equal(mismatch.status,409);
  });
  await check('partial sale creates due account and ledger through Worker',async()=>{
    const r=await request('POST','/api/pos/sales',
      sale('d1-ci-partial-sale-002',2,'Partial',80,'01000000777'),{token});
    assert.equal(r.ok,true,JSON.stringify(r));
    partialInvoice=r.invoice.invoiceId;
    assert.equal(r.invoice.paidAmount,80);
    assert.equal(r.invoice.dueAmount,120);
    const recent=await request('GET','/api/pos/sales-by-phone?phone=01000000777',undefined,{token});
    assert.ok(recent.sales.some(x=>x.invoiceId===partialInvoice));
  });
  await check('concurrent identical requests cannot create two invoices',async()=>{
    const concurrent=sale('d1-ci-concurrent-key-003',1,'Cash',0,'01000000888');
    const res=await Promise.all(Array.from({length:3},()=>request('POST','/api/pos/sales',concurrent,{token})));
    assert.ok(res.every(x=>x.ok),JSON.stringify(res));
    assert.equal(new Set(res.map(x=>x.invoice.invoiceId)).size,1);
  });
  await check('oversell is rejected with no stock loss',async()=>{
    const r=await request('POST','/api/pos/sales',
      sale('d1-ci-oversell-key-004',99,'Cash',0,'01000000999'),{token});
    assert.equal(r.ok,false);
  });
  await check('real React browser signs in, reads D1 products, posts POS sale and fetches receipt',async()=>{
    // No API mocking. Uses Wrangler's real assets + Hono + this test D1.
    report.realBrowser=await runRealD1Browser();
    assert.equal(report.realBrowser.checks.length,7);
  });
} catch(err){
  report.failed.push({name:'runner',message:String(err?.stack||err)});
} finally{
  if(worker){
    worker.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve=>worker.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,6000))
    ]);
    if(worker.exitCode===null)worker.kill('SIGKILL');
  }
  try{
    // Query after Worker shutdown to verify the saved SQL state, not just HTTP responses.
    const qty=query("SELECT current_stock AS stock FROM products WHERE product_id='"+productId+"'");
    const sales=query("SELECT COUNT(*) AS n FROM sales");
    const rows=query("SELECT SUM(quantity) AS units FROM sale_item_lots WHERE invoice_id='"+paidInvoice+"'");
    const cash=query("SELECT credit FROM cash_book WHERE type='Sale' AND reference='"+paidInvoice+"'");
    const customer=query("SELECT current_due AS due FROM customers WHERE phone='01000000777'");
    const ledger=query("SELECT debit AS due FROM customer_ledger WHERE reference='"+partialInvoice+"'");
    const requestKeys=query('SELECT COUNT(*) AS n FROM pos_sale_requests');
    const browserSale=query("SELECT invoice_id,grand_total,paid_amount,due_amount FROM sales WHERE customer_phone='01000000123'");
    const browserLot=query("SELECT SUM(quantity) AS qty FROM sale_item_lots WHERE invoice_id=(SELECT invoice_id FROM sales WHERE customer_phone='01000000123')");
    const browserCash=query("SELECT credit FROM cash_book WHERE type='Sale' AND reference=(SELECT invoice_id FROM sales WHERE customer_phone='01000000123')");
    const audit={stock:qty[0]?.stock,sales:sales[0]?.n,paidSaleLotQty:rows[0]?.units,
      cashReceived:cash[0]?.credit,customerDue:customer[0]?.due,
      ledgerDue:ledger[0]?.due,requestKeys:requestKeys[0]?.n,
      browserInvoiceCount:browserSale.length,browserTotal:browserSale[0]?.grand_total,
      browserPaid:browserSale[0]?.paid_amount,browserDue:browserSale[0]?.due_amount,
      browserLotQty:browserLot[0]?.qty,browserCash:browserCash[0]?.credit};
    report.databaseAudit=audit;
    assert.equal(audit.stock,3);
    assert.equal(audit.sales,4);
    assert.equal(audit.paidSaleLotQty,2);
    assert.equal(audit.cashReceived,200);
    assert.equal(audit.customerDue,120);
    assert.equal(audit.ledgerDue,120);
    assert.equal(audit.requestKeys,4);
    assert.equal(audit.browserInvoiceCount,1);
    assert.equal(audit.browserTotal,100);
    assert.equal(audit.browserPaid,100);
    assert.equal(audit.browserDue,0);
    assert.equal(audit.browserLotQty,1);
    assert.equal(audit.browserCash,100);
    report.passed.push('D1 SQL reconciliation after Worker shutdown');
  }catch(e){report.failed.push({name:'D1 SQL reconciliation',message:String(e?.stack||e)});}
  report.finishedAt=new Date().toISOString();
  writeFileSync(join(out,'d1-local-results.json'),JSON.stringify(report,null,2));
  // Never write setup tokens or full request bodies to artifacts.
  writeFileSync(join(out,'worker.log'),logs.replaceAll(setupSecret,'[redacted]').slice(-12000));
  rmSync(state,{recursive:true,force:true});
}
process.stdout.write('Local Worker+D1: '+report.passed.length+' passed; '+report.failed.length+' failed\n');
if(report.failed.length)process.exitCode=1;
