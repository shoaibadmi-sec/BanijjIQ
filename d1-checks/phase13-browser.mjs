/** Phase 13: real Chromium -> React -> local Worker -> isolated D1. NO HTTP mocks. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runBrowserAcceptance} from '../scripts/preview/browser-acceptance.mjs';
const root=resolve(process.cwd()),web=join(root,'.generated/hisabiq-web');
const require=createRequire(pathToFileURL(join(web,'package.json')));
const {chromium}=require('playwright');
const config=join(root,'wrangler.d1-ci.jsonc');
const testDb=JSON.parse(readFileSync(config,'utf8')),prod=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
assert.equal(testDb.d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
assert.notEqual(testDb.name,prod.name);
assert.notEqual(testDb.d1_databases[0].database_id,prod.d1_databases[0].database_id);
const pkg=JSON.parse(readFileSync(join(root,'node_modules/wrangler/package.json'),'utf8'));
const bin=join(root,'node_modules/wrangler',typeof pkg.bin==='string'?pkg.bin:pkg.bin.wrangler);
const state=mkdtempSync(join(tmpdir(),'hisabiq-phase13-live-')),out=join(root,'d1-checks/output');
const base='http://127.0.0.1:8793',secret='P13-ONLY-LOCAL-SETUP';
const env={...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''};
const report={passed:[],failed:[],a11y:[],layouts:[],screenshots:[],requests:[],errors:[],audit:{},invoices:{}};
const ids={},invoices={};let token='',worker,browser,logs='';
mkdirSync(out,{recursive:true});
function cli(args){
 assert.ok(args.includes('--local')&&args.includes('--persist-to')&&!args.includes('--remote'));
 const r=spawnSync(process.execPath,[bin,...args,'--config',config],{cwd:root,env,encoding:'utf8',timeout:120000});
 if(r.status!==0)throw Error('local D1 command failed: '+(r.stderr||r.stdout).slice(-1500));
 return r.stdout;
}
function query(q){
 const s=cli(['d1','execute','DB','--local','--persist-to',state,'--json','--command',q]);
 return JSON.parse(s.slice(s.indexOf('[')))[0]?.results||[];
}
const one=q=>query(q)[0]||{},esc=s=>String(s).replaceAll("'","''");
async function api(method,path,body,setup=false){
 const headers={'content-type':'application/json'};
 if(token)headers.authorization='Bearer '+token;
 if(setup)headers['x-setup-secret']=secret;
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
 const j=await r.json();assert.equal(j.ok,true,method+' '+path+': '+JSON.stringify(j));return j;
}
async function check(name,fn){try{await fn();report.passed.push(name);console.log('PASS '+name);}
 catch(e){report.failed.push({name,error:String(e?.stack||e)});console.error('FAIL '+name,e);throw e;}}
async function ready(){
 for(let i=0;i<100;i++){if(worker.exitCode!==null)throw Error('Worker exited: '+logs.slice(-1000));
 try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(700)})).ok)return;}catch{}
 await new Promise(r=>setTimeout(r,350));}throw Error('local Worker startup failure');
}
async function seed(key,details){
 const p={productName:'P13 '+key,category:'Electrical',unit:'Pcs',brand:'',
 barcode:'P13-'+key.replaceAll(' ','-'),currentStock:1,minimumStock:0,purchasePrice:20,
 sellingPrice:100,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false,...details};
 ids[key]=(await api('POST','/api/products',p)).productId;
}
async function open(width,path){
 const ctx=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
 await ctx.addInitScript(v=>localStorage.setItem('shererp_auth_token',v),token);
 const page=await ctx.newPage();
 page.on('dialog',d=>void d.accept());
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))
 report.requests.push({width,method:r.method(),path:new URL(r.url()).pathname});});
 await page.goto(base+path,{waitUntil:'domcontentloaded'});
 return {page,ctx};
}
async function inspect(page,key,selector){
 const layout=await page.evaluate(s=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
 width:document.querySelector(s)?.getBoundingClientRect().width||0}),selector);
 report.layouts.push({key,...layout});
 assert.ok(layout.width>150,key+' missing workspace');
 assert.ok(layout.documentWidth<=layout.viewport+4,key+' document overflow '+JSON.stringify(layout));
 await page.addScriptTag({content:readFileSync(join(web,'node_modules/axe-core/axe.min.js'),'utf8')});
 const a=await page.evaluate(async s=>{const r=await window.axe.run(document.querySelector(s),
 {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
 return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.slice(0,3).map(n=>n.target)}));},selector);
 report.a11y.push({key,violations:a});
 assert.equal(a.filter(v=>v.impact==='critical').length,0,key+' critical a11y violations');
 const img='phase13-live-'+key+'.png';await page.screenshot({path:join(out,img),fullPage:true,animations:'disabled'});
 report.screenshots.push(img);
}
async function sale(page,key,amount,phone){
 await page.locator('input[list="live-pos-customer-names"]').fill('P13 '+key+' customer');
 await page.locator('input[list="live-pos-customer-phones"]').fill(phone);
 await page.getByRole('spinbutton',{name:/Amount received/}).fill(String(amount));
 const b=page.getByRole('button',{name:'Review and post real sale'});
 assert.equal(await b.isEnabled(),true,key+' checkout blocked: '+(await page.locator('[role="alert"]').allTextContents()).join('|'));
 await b.click();
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/pos/sales'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Confirm and post'}).click();
 const r=await response,p=await r.json();assert.equal(p.ok,true,JSON.stringify(p));
 invoices[key]=p.invoice.invoiceId;report.invoices[key]=p.invoice.invoiceId;
 await page.getByText('Sale posted successfully').waitFor();
}
async function add(page,name){
 await page.locator('[data-live-pos]').waitFor({timeout:18000});
 await page.locator('[data-live-pos] button').filter({hasText:name}).first().click();
 await page.getByRole('spinbutton',{name:'Quantity for '+name}).waitFor();
}

async function refund(page,key,name,amount,serial){
 await page.locator('[data-live-sales-returns]').waitFor({timeout:15000});
 await page.getByRole('textbox',{name:'Search saved invoices'}).fill(invoices[key]);
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('button',{name:new RegExp(invoices[key])}).click();
 await page.getByRole('spinbutton',{name:'Return quantity for '+name}).fill('1');
 if(serial){await page.getByRole('button',{name:/Serial \/ IMEI/}).click();
 await page.getByRole('button',{name:new RegExp(serial)}).click();
 await page.getByRole('button',{name:'Use serials'}).click();}
 await page.getByPlaceholder('Why was this returned?').fill('P13 verified test refund');
 const b=page.getByRole('button',{name:'Review real return'});
 assert.equal(await b.isEnabled(),true,'Return preflight blocked: '+(await page.locator('[role="alert"]').allTextContents()));
 await b.click();
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales-returns'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Confirm & refund'}).click();
 const r=await response,p=await r.json();assert.equal(p.ok,true,JSON.stringify(p));
 assert.equal(p.totalReturnAmount,amount);
 await page.getByText(p.returnId).waitFor();
}
try{
 await check('only isolated local D1 migrations',async()=>{
  const r=cli(['d1','migrations','apply','DB','--local','--persist-to',state]);
  assert.match(r,/0032_sales_reversal_concurrency_guards/);
 });
 worker=spawn(process.execPath,[bin,'dev','--config',config,'--local','--persist-to',state,
 '--ip','127.0.0.1','--port','8793','--var','SETUP_SECRET:'+secret],
 {cwd:root,env,stdio:['ignore','pipe','pipe']});
 for(const stream of [worker.stdout,worker.stderr])
  stream.on('data',c=>{logs=(logs+String(c)).slice(-18000);});
 await ready();
 await check('setup synthetic administrator, cash session and tracked lots',async()=>{
  const a=await api('POST','/api/setup/admin',
   {fullName:'P13 Browser Admin',phone:'01000001300',password:'P13-Local-Password!'},true);
  token=a.token;
  await api('POST','/api/pos/cash-session/start',{openingCash:0});
  await seed('A Serial',{currentStock:2,sellingPrice:120,trackSerial:true,
    openingTracking:{serialNumbers:['P13-IMEI-A','P13-IMEI-B']}});
  await seed('B Expiry',{currentStock:2,sellingPrice:80,trackExpiry:true,
    openingTracking:{expiryBatches:[{batchNo:'OLD',expiryDate:'2020-01-01',quantity:1},
      {batchNo:'VALID',expiryDate:'2099-12-31',quantity:1}]}});
  await seed('C Negative',{currentStock:1,sellingPrice:50});
  await seed('D Vendor',{currentStock:1,sellingPrice:70});
 });
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await check('Phase 14 preview browser acceptance rehearsal on isolated local Worker/D1',async()=>{
  const r=await runBrowserAcceptance({
   baseUrl:base,phone:'01000001300',password:'P13-Local-Password!',
   browser,allowLocal:true,outputDir:out
  });
  assert.equal(r.passed.length,15);
  assert.equal(r.blockedWrites.length,0);
  assert.equal(r.browserErrors.length,0);
  report.previewAcceptance={mode:r.mode,checks:r.passed.length,screenshots:r.screenshots.length,
   wcagAudits:r.accessibility.length,blockedBusinessWrites:r.blockedWrites.length};
 });
 await check('real 390px browser login + mobile POS accessibility',async()=>{
  const ctx=await browser.newContext({viewport:{width:390,height:960},reducedMotion:'reduce'});
  const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  try{
   await page.goto(base+'/#/app/products');
   await page.getByText('Sign in · BanijjIQ').waitFor({timeout:15000});
   await page.getByLabel('Mobile number').fill('01000001300');
   await page.getByLabel('Password').fill('P13-Local-Password!');
   await page.getByRole('button',{name:/Sign in/}).click();
   await page.locator('[data-live-products]').waitFor({timeout:16000});
   await page.goto(base+'/#/app/pos');
   await page.locator('[data-live-pos]').waitFor({timeout:16000});
   await inspect(page,'mobile-pos-390','[data-live-pos]');
  }finally{await ctx.close();}
 });
 await check('real 1440px React serial-picker sale to D1 (120)',async()=>{
  const {page,ctx}=await open(1440,'/#/app/pos');
  try{
   await add(page,'P13 A Serial');
   await page.getByRole('button',{name:/Serial \/ IMEI/}).click();
   await page.getByRole('button',{name:/P13-IMEI-A/}).click();
   await page.getByRole('button',{name:'Use serials'}).click();
   await inspect(page,'serial-pos-1440','[data-live-pos]');
   await sale(page,'serial',120,'01000001301');
  }finally{await ctx.close();}
 });
 await check('real 768px React expiry FEFO sale to D1 (80)',async()=>{
  const {page,ctx}=await open(768,'/#/app/pos');
  try{await add(page,'P13 B Expiry');await inspect(page,'expiry-pos-768','[data-live-pos]');
   await sale(page,'expiry',80,'01000001302');}finally{await ctx.close();}
 });
 await check('real 390px React negative-stock choice to D1 (150)',async()=>{
  const {page,ctx}=await open(390,'/#/app/pos');
  try{
   await add(page,'P13 C Negative');
   await page.getByRole('spinbutton',{name:'Quantity for P13 C Negative'}).fill('3');
   await page.getByRole('button',{name:'Resolve stock shortage'}).click();
   await page.getByRole('radio',{name:/Negative Sale/}).click();
   await page.getByRole('button',{name:'Allow negative sale'}).click();
   await inspect(page,'negative-pos-390','[data-live-pos]');
   await sale(page,'negative',150,'01000001303');
  }finally{await ctx.close();}
 });
 await check('real 1024px React vendor quick-add and sourced sale to D1 (210)',async()=>{
  const {page,ctx}=await open(1024,'/#/app/pos');
  try{
   await add(page,'P13 D Vendor');
   await page.getByRole('spinbutton',{name:'Quantity for P13 D Vendor'}).fill('3');
   await page.getByRole('button',{name:'Resolve stock shortage'}).click();
   await page.getByRole('radio',{name:/Vendor/}).click();
   await page.getByRole('textbox',{name:'New vendor name'}).fill('P13 Test Vendor');
   await page.getByRole('textbox',{name:'New vendor phone'}).fill('01000001310');
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/pos/vendors'&&r.request().method()==='POST');
   await page.getByRole('button',{name:'+ Add & select vendor'}).click();
   const r=await response,v=(await r.json()).vendor;
   assert.equal(r.status(),200);ids.vendorAccount=v.id;
   assert.equal(await page.getByRole('combobox',{name:'Select live vendor'}).inputValue(),v.id);
   await page.getByRole('spinbutton',{name:'Vendor unit cost'}).fill('35');
   await page.getByRole('button',{name:'Use vendor'}).click();
   await inspect(page,'vendor-pos-1024','[data-live-pos]');
   await sale(page,'vendor',210,'01000001304');
  }finally{await ctx.close();}
 });
 await check('real 390px React serial return posts D1 cash refund (120)',async()=>{
  const {page,ctx}=await open(390,'/#/app/live-sales-returns');
  try{await refund(page,'serial','P13 A Serial',120,'P13-IMEI-A');
   await inspect(page,'serial-return-390','[data-live-sales-returns]');}finally{await ctx.close();}
 });
 await check('real 768px React expiry return posts D1 cash refund (80)',async()=>{
  const {page,ctx}=await open(768,'/#/app/live-sales-returns');
  try{await refund(page,'expiry','P13 B Expiry',80);
   await inspect(page,'expiry-return-768','[data-live-sales-returns]');}finally{await ctx.close();}
 });
 assert.equal(report.errors.length,0,'browser errors: '+report.errors.join('; '));
}catch(e){report.failed.push({name:'runner',error:String(e?.stack||e)});}
finally{
 try{await browser?.close();}catch{}
 if(worker){worker.kill('SIGTERM');await Promise.race([new Promise(r=>worker.once('exit',r)),
 new Promise(r=>setTimeout(r,6000))]);if(worker.exitCode===null)worker.kill('SIGKILL');}
 try{await check('post-browser SQL reconciliation of stock, serials, vendor liability, refunds',async()=>{
  assert.deepEqual(Object.keys(invoices).sort(),['expiry','negative','serial','vendor']);
  function count(key){return one("SELECT current_stock n FROM products WHERE product_id='"+esc(ids[key])+"'").n;}
  for(const [key,n] of [['A Serial',2],['B Expiry',2],['C Negative',-2],['D Vendor',0]])
   assert.equal(count(key),n,key);
  assert.equal(one("SELECT remaining_quantity n FROM stock_lots WHERE product_id='"+
   esc(ids['C Negative'])+"' AND source_type='OVERSOLD'").n,-2);
  assert.equal(one("SELECT COUNT(*) n FROM product_serials WHERE product_id='"+
   esc(ids['A Serial'])+"' AND status='In Stock'").n,2);
  assert.equal(one("SELECT COALESCE(SUM(remaining_quantity),0) n FROM stock_expiry_batches WHERE product_id='"+
   esc(ids['B Expiry'])+"' AND expiry_date='2099-12-31'").n,1);
  assert.equal(one("SELECT COALESCE(SUM(remaining_quantity),0) n FROM stock_expiry_batches WHERE product_id='"+
   esc(ids['B Expiry'])+"' AND expiry_date='2020-01-01'").n,1);
  assert.equal(one("SELECT current_due n FROM vendors WHERE vendor_id='"+esc(ids.vendorAccount)+"'").n,70);
  assert.equal(one("SELECT COALESCE(SUM(total_cost),0) n FROM vendor_sourcing WHERE invoice_id='"+
   esc(invoices.vendor)+"'").n,70);
  assert.equal(one("SELECT COUNT(*) n FROM sales").n,4);
  assert.equal(one("SELECT COUNT(*) n FROM sales_returns").n,2);
  assert.equal(one("SELECT COUNT(*) n FROM pos_sale_requests").n,4);
  assert.equal(one("SELECT COALESCE(SUM(credit),0) n FROM cash_book WHERE type='Sale' AND is_deleted=0").n,560);
  assert.equal(one("SELECT COALESCE(SUM(debit),0) n FROM cash_book WHERE type='Sales Return' AND is_deleted=0").n,200);
  assert.equal(one("SELECT COALESCE(SUM(due_amount),0) n FROM sales").n,0);
  report.audit={sales:4,returns:2,saleCash:560,refundCash:200,netCash:360,
   vendorDue:70,negativeStock:-2,serialsRestored:2,expiryBatchRestored:true};
 });}catch(e){report.failed.push({name:'SQL reconciliation',error:String(e?.stack||e)});}
 writeFileSync(join(out,'phase13-real-browser-results.json'),JSON.stringify(report,null,2));
 writeFileSync(join(out,'phase13-worker.log'),logs.replaceAll(secret,'[redacted]').slice(-12000));
 rmSync(state,{recursive:true,force:true});
}
console.log('Phase13 Real Browser/D1: '+report.passed.length+' passed; '+report.failed.length+' failed');
if(report.failed.length)process.exitCode=1;
