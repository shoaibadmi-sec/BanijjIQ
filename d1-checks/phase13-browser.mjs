/** Phase 13: real Chromium -> React -> local Worker -> isolated D1. NO HTTP mocks. */
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
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
