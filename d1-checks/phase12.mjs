/**
 * Phase 12: independent end-to-end financial regression against a disposable
 * Wrangler --local Worker/D1. No remote bindings, secrets or production data.
 * Run separately from run.mjs to preserve its original reconciliation totals.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root=resolve(process.cwd());
const cfg=join(root,'wrangler.d1-ci.jsonc');
const preview=JSON.parse(readFileSync(cfg,'utf8'));
const production=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
assert.equal(preview.d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
assert.notEqual(preview.name,production.name);
assert.notEqual(preview.d1_databases[0].database_id,production.d1_databases[0].database_id);
const pkg=JSON.parse(readFileSync(join(root,'node_modules/wrangler/package.json'),'utf8'));
const cli=join(root,'node_modules/wrangler',typeof pkg.bin==='string'?pkg.bin:pkg.bin.wrangler);
const state=mkdtempSync(join(tmpdir(),'hisabiq-p12-d1-'));
const out=join(root,'d1-checks/output');
const base='http://127.0.0.1:8792';
const secret='LOCAL-CI-ONLY-PHASE12-NEVER-DEPLOY';
mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),source:'isolated Wrangler local D1',passed:[],failed:[],audit:{},http:[]};
let logs='',worker,token='';
const ids={},invoices={},returns={};
function wrangler(args){
  assert.ok(args.includes('--local')&&args.includes('--persist-to')&&!args.includes('--remote'),'Local D1 only');
  const r=spawnSync(process.execPath,[cli,...args,'--config',cfg],{cwd:root,encoding:'utf8',timeout:120000,
    env:{...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}});
  if(r.error)throw r.error;
  if(r.status!==0)throw Error('Local Wrangler: '+(r.stderr||r.stdout).slice(-2000));
  return r.stdout;
}
function query(sql){
  const s=wrangler(['d1','execute','DB','--local','--persist-to',state,'--json','--command',sql]);
  const i=s.indexOf('[');
  if(i<0)throw Error('No Wrangler SQL JSON');
  return JSON.parse(s.slice(i))[0]?.results||[];
}
function esc(v){return String(v).replaceAll("'","''");}
async function api(method,path,body,auth=true){
  const headers={'content-type':'application/json'};
  if(auth&&token)headers.authorization='Bearer '+token;
  if(path==='/api/setup/admin')headers['x-setup-secret']=secret;
  const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(18000)});
  const raw=await r.text();
  let data;
  try{data=JSON.parse(raw);}catch{throw Error(method+' '+path+' returned non-JSON HTTP '+r.status);}
  report.http.push({method,path:path.replace(/(INV-|SRT-)[A-Za-z0-9-]+/g,'$1[redacted]'),status:r.status});
  return {status:r.status,...data};
}
async function check(name,fn){
  try{await fn();report.passed.push(name);process.stdout.write('PASS '+name+'\n');}
  catch(e){report.failed.push({name,error:String(e?.stack||e)});throw e;}
}
function sale(key,id,qty,price,other={}){
  return {clientRequestId:'phase12-'+key,customerName:'Phase12 Synthetic Buyer',
    customerPhone:'01000001234',paymentType:'Cash',paidAmount:0,paymentMethod:'Cash',discount:0,
    items:[{productId:id,name:'Phase12 item',qty,unitPrice:price,fulfillmentMode:'own',...other}]};
}
async function add(key,stock,extra={}){
  const p={productName:'P12 '+key,brand:'',category:'Electrical',unit:'Pcs',
    barcode:'P12-'+key,purchasePrice:20,sellingPrice:100,currentStock:stock,minimumStock:0,
    status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false,...extra};
  const r=await api('POST','/api/products',p);
  assert.equal(r.ok,true,JSON.stringify(r));
  ids[key]=r.productId;return r.productId;
}
async function post(key,payload){
  const r=await api('POST','/api/pos/sales',payload);
  assert.equal(r.ok,true,JSON.stringify(r));invoices[key]=r.invoice.invoiceId;return r;
}
async function ret(key,invoice,id,price,serialNumbers){
  const item={productId:id,qty:1,unitPrice:price};
  if(serialNumbers)item.serialNumbers=serialNumbers;
  const r=await api('POST','/api/sales-returns',{invoiceId:invoice,refundMethod:'Cash',
    reason:'Phase12 regression',items:[item]});
  assert.equal(r.ok,true,JSON.stringify(r));returns[key]=r.returnId;return r;
}
async function waitWorker(){
  for(let i=0;i<120;i++){
    if(worker.exitCode!==null)throw Error('Worker exited: '+logs.slice(-1200));
    try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(850)})).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  throw Error('Worker never started: '+logs.slice(-1200));
}
try{
  await check('all migrations applied only to disposable D1',async()=>{
    const r=wrangler(['d1','migrations','apply','DB','--local','--persist-to',state]);
    assert.match(r,/0029_pos_atomic_stock_guard/);
    assert.ok(query("SELECT name FROM sqlite_master WHERE type='table' AND name='sales_return_items'").length);
  });
  worker=spawn(process.execPath,[cli,'dev','--config',cfg,'--local','--persist-to',state,
    '--ip','127.0.0.1','--port','8792','--var','SETUP_SECRET:'+secret],{
    cwd:root,stdio:['ignore','pipe','pipe'],
    env:{...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}
  });
  for(const stream of [worker.stdout,worker.stderr])
    stream.on('data',chunk=>{logs=(logs+String(chunk)).slice(-16000);});
  await waitWorker();
  await check('synthetic admin, auth and cash session',async()=>{
    assert.equal((await api('GET','/api/pos/bootstrap')).status,401);
    const r=await api('POST','/api/setup/admin',{fullName:'P12 Admin',phone:'01000001200',
      password:'Phase12-Synthetic!'},false);
    assert.equal(r.ok,true,JSON.stringify(r));token=r.token;
    assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
  });

  await check('serial required, sale allocation, no duplicate serial checkout',async()=>{
    const id=await add('serial',2,{trackSerial:true,
      openingTracking:{serialNumbers:['P12-IMEI-A','P12-IMEI-B']}});
    const missing=await api('POST','/api/pos/sales',sale('serial-missing',id,1,120));
    assert.equal(missing.ok,false);assert.match(missing.error,/Serial|IMEI/i);
    await post('serial',sale('serial-success',id,1,120,{serialNumbers:['P12-IMEI-A']}));
    const duplicate=await api('POST','/api/pos/sales',
      sale('serial-duplicate',id,1,120,{serialNumbers:['P12-IMEI-A']}));
    assert.equal(duplicate.ok,false);
    const blockedDelete=await api('DELETE','/api/sales-management/'+encodeURIComponent(invoices.serial),
      {reason:'Tracked sale cannot be deleted'});
    assert.equal(blockedDelete.ok,false);assert.match(blockedDelete.error,/Serial|Expiry/i);
  });
  await check('tracked serial return restores its serial and original lot once',async()=>{
    await ret('serial',invoices.serial,ids.serial,120,['P12-IMEI-A']);
    const repeat=await api('POST','/api/sales-returns',{invoiceId:invoices.serial,
      refundMethod:'Cash',reason:'Double return rejected',
      items:[{productId:ids.serial,qty:1,unitPrice:120,serialNumbers:['P12-IMEI-A']}]});
    assert.equal(repeat.ok,false);
  });
  await check('expiry FEFO excludes expired batch and return restores tracked lot',async()=>{
    const id=await add('expiry',2,{trackExpiry:true,openingTracking:{expiryBatches:[
      {quantity:1,expiryDate:'2020-01-01',batchNo:'EXPIRED'},
      {quantity:1,expiryDate:'2099-12-31',batchNo:'VALID'}]}});
    await post('expiry',sale('expiry-success',id,1,80));
    const expired=await api('POST','/api/pos/sales',sale('expiry-reject',id,1,80));
    assert.equal(expired.ok,false);assert.match(expired.error,/non-expired|tracked/i);
    await ret('expiry',invoices.expiry,id,80);
  });
  await check('explicit negative stock produces one oversold lot; cancel restores stock',async()=>{
    const id=await add('negative',1);
    await post('negative',sale('negative-success',id,3,50,{fulfillmentMode:'negative'}));
    const r=await api('DELETE','/api/sales-management/'+encodeURIComponent(invoices.negative),
      {reason:'P12 reversal negative stock'});
    assert.equal(r.ok,true,JSON.stringify(r));
    const deleted=await api('GET','/api/pos/invoices/'+encodeURIComponent(invoices.negative));
    assert.equal(deleted.status,404);
  });
  await check('vendor shortage records exact liability; cancel reverses sourcing',async()=>{
    const id=await add('vendor',0);
    const vendor=await api('POST','/api/pos/vendors',{name:'P12 Synthetic Vendor',phone:'01000001222'});
    assert.equal(vendor.ok,true,JSON.stringify(vendor));ids.vendorAccount=vendor.vendor.id;
    await post('vendor',sale('vendor-success',id,2,70,{fulfillmentMode:'vendor',
      vendorId:ids.vendorAccount,vendorUnitCost:35}));
    const r=await api('DELETE','/api/sales-management/'+encodeURIComponent(invoices.vendor),
      {reason:'P12 reversal vendor liability'});
    assert.equal(r.ok,true,JSON.stringify(r));
  });
  await check('two different buyers cannot both claim one tracked serial',async()=>{
    const id=await add('serialrace',1,{trackSerial:true,
      openingTracking:{serialNumbers:['P12-IMEI-RACE']}});
    const attempts=await Promise.all(['A','B'].map(k=>api('POST','/api/pos/sales',
      sale('serial-race-'+k,id,1,65,{serialNumbers:['P12-IMEI-RACE']}))));
    assert.equal(attempts.filter(x=>x.ok).length,1,JSON.stringify(attempts));
    assert.equal(attempts.filter(x=>!x.ok).length,1);
    invoices.serialrace=attempts.find(x=>x.ok).invoice.invoiceId;
  });
  await check('competing same-item cash returns refund only once',async()=>{
    const id=await add('returnrace',1);
    await post('returnrace',sale('returnrace-sale',id,1,90));
    const payload={invoiceId:invoices.returnrace,refundMethod:'Cash',reason:'P12 simultaneous return',
      items:[{productId:id,qty:1,unitPrice:90}]};
    const res=await Promise.all([api('POST','/api/sales-returns',payload),
      api('POST','/api/sales-returns',payload)]);
    assert.equal(res.filter(x=>x.ok).length,1,JSON.stringify(res));
    assert.equal(res.filter(x=>!x.ok).length,1);
    returns.returnrace=res.find(x=>x.ok).returnId;
  });
  await check('competing invoice cancellations mark sale deleted exactly once',async()=>{
    const id=await add('deleterace',1);
    await post('deleterace',sale('deleterace-sale',id,1,45));
    const path='/api/sales-management/'+encodeURIComponent(invoices.deleterace);
    const res=await Promise.all([api('DELETE',path,{reason:'First concurrent cancellation'}),
      api('DELETE',path,{reason:'Second concurrent cancellation'})]);
    assert.equal(res.filter(x=>x.ok).length,1,JSON.stringify(res));
    assert.equal(res.filter(x=>!x.ok).length,1);
  });
} catch(e){
  report.failed.push({name:'runner',error:String(e?.stack||e)});
  process.stderr.write('FAIL Phase12: '+String(e?.stack||e)+'\n');
} finally{
  if(worker){
    worker.kill('SIGTERM');
    await Promise.race([new Promise(r=>worker.once('exit',r)),new Promise(r=>setTimeout(r,6000))]);
    if(worker.exitCode===null)worker.kill('SIGKILL');
  }
  try{
    // Queries are independent of HTTP responses and occur after Worker shutdown.
    const one=sql=>query(sql)[0]||{};
    function stock(key){
      const id=esc(ids[key]);
      const p=one("SELECT current_stock AS stock FROM products WHERE product_id='"+id+"'");
      const l=one("SELECT COALESCE(SUM(remaining_quantity),0) AS units FROM stock_lots WHERE product_id='"+id+"' AND source_type<>'OVERSOLD'");
      return {stock:Number(p.stock),ordinaryLots:Number(l.units)};
    }
    const balances={};
    for(const key of ['serial','expiry','negative','vendor','serialrace','returnrace','deleterace'])
      if(ids[key])balances[key]=stock(key);
    report.audit.balances=balances;
    for(const [key,expected] of Object.entries({serial:2,expiry:2,negative:1,vendor:0,
      serialrace:0,returnrace:1,deleterace:1})){
      assert.equal(balances[key]?.stock,expected,key+' product stock');
      assert.equal(balances[key]?.ordinaryLots,expected,key+' physical lots');
    }
    assert.equal(one("SELECT COUNT(*) n FROM stock_lots WHERE product_id='"+esc(ids.negative)+
      "' AND source_type='OVERSOLD' AND remaining_quantity=0").n,1);
    assert.equal(one("SELECT COUNT(*) n FROM sales WHERE invoice_id='"+esc(invoices.negative)+
      "' AND is_deleted=1").n,1);
    assert.equal(one("SELECT COUNT(*) n FROM sales WHERE invoice_id='"+esc(invoices.vendor)+
      "' AND is_deleted=1").n,1);
    assert.equal(one("SELECT COUNT(*) n FROM vendor_sourcing WHERE invoice_id='"+esc(invoices.vendor)+"'").n,0);
    assert.equal(one("SELECT current_due AS due FROM vendors WHERE vendor_id='"+esc(ids.vendorAccount)+"'").due,0);
    assert.equal(one("SELECT COUNT(*) n FROM vendor_ledger WHERE vendor_id='"+esc(ids.vendorAccount)+
      "' AND type='Sourcing'").n,0);
    assert.equal(one("SELECT COUNT(*) n FROM product_serials WHERE product_id='"+esc(ids.serial)+
      "' AND status='In Stock'").n,2);
    assert.equal(one("SELECT COUNT(*) n FROM product_serials WHERE product_id='"+esc(ids.serialrace)+
      "' AND status='Sold'").n,1);
    assert.equal(one("SELECT COALESCE(SUM(remaining_quantity),0) n FROM stock_expiry_batches WHERE product_id='"+
      esc(ids.expiry)+"' AND expiry_date='2099-12-31'").n,1);
    assert.equal(one("SELECT COALESCE(SUM(remaining_quantity),0) n FROM stock_expiry_batches WHERE product_id='"+
      esc(ids.expiry)+"' AND expiry_date='2020-01-01'").n,1);
    assert.equal(one("SELECT COUNT(*) n FROM sales_return_items WHERE invoice_id='"+
      esc(invoices.returnrace)+"'").n,1);
    assert.equal(one("SELECT COALESCE(SUM(debit),0) n FROM cash_book WHERE type='Sales Return' AND reference IN "+
      "(SELECT return_id FROM sales_returns WHERE invoice_id='"+esc(invoices.returnrace)+"')").n,90);
    assert.equal(one("SELECT COUNT(*) n FROM audit_logs WHERE action='DELETE_SALE' AND entity_id='"+
      esc(invoices.deleterace)+"'").n,1);
    assert.equal(one("SELECT COUNT(*) n FROM pos_sale_requests WHERE request_id LIKE 'phase12-%'").n,7);
    assert.equal(one("SELECT COUNT(*) n FROM sales WHERE invoice_id IN ('"+
      Object.values(invoices).map(esc).join("','")+"')").n,7);
    const integrity=query('PRAGMA integrity_check');
    assert.equal(integrity[0]?.integrity_check,'ok');
    const fks=query('PRAGMA foreign_key_check');
    assert.equal(fks.length,0);
    report.audit.sales=one("SELECT COUNT(*) n FROM sales WHERE customer_phone='01000001234'").n;
    report.audit.refunds=one("SELECT COUNT(*) n FROM sales_returns").n;
    report.audit.serialsSold=one("SELECT COUNT(*) n FROM product_serials WHERE status='Sold'").n;
    report.audit.integrity='ok';report.audit.foreignKeyViolations=0;
    report.passed.push('exact SQL stock, FIFO, serial, expiry, refunds, vendor dues, cancellation and key audit');
  }catch(e){report.failed.push({name:'SQL reconciliation',error:String(e?.stack||e)});
    process.stderr.write('FAIL Phase12 SQL: '+String(e?.stack||e)+'\n');}
  report.finishedAt=new Date().toISOString();
  writeFileSync(join(out,'phase12-results.json'),JSON.stringify(report,null,2));
  writeFileSync(join(out,'phase12-worker.log'),logs.replaceAll(secret,'[redacted]').slice(-10000));
  rmSync(state,{recursive:true,force:true});
}
process.stdout.write('Phase12 Worker+D1: '+report.passed.length+' passed / '+report.failed.length+' failed\n');
if(report.failed.length)process.exitCode=1;
