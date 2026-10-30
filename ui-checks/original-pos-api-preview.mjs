/** Verify existing HisabIQ Pos/CartTable loads real-shaped API product data, no demo seed or posting. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const web=resolve('.generated/hisabiq-web');
const require=createRequire(pathToFileURL(join(web,'package.json')));
const {chromium}=require('playwright');
const host='http://127.0.0.1:4197';
const server=spawn('node',[join(web,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','4197','--strictPort'],{cwd:web,stdio:'ignore'});
let browser;
try{
 let ready=false;
 for(let i=0;i<80;i++){
   if(server.exitCode!==null)throw new Error('Vite preview terminated unexpectedly: '+server.exitCode);
   try{ready=(await fetch(host+'/')).ok;if(ready)break;}catch{}
   await new Promise(r=>setTimeout(r,250));
 }
 assert.ok(ready,'Preview server did not start');
 browser=await chromium.launch({headless:true});
 for(const width of [390,768,1440]){
   const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   const calls=[];
   await ctx.route('**/api/**',route=>{
     const path=new URL(route.request().url()).pathname;
     calls.push({path,method:route.request().method()});
     const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
     if(path==='/api/auth/me')return json({ok:true,user:{userId:'CI-ADMIN',fullName:'CI Admin',phone:'01700000000',role:'admin',permissions:{}}});
     if(path==='/api/bootstrap')return json({ok:true,products:[
       {productId:'D1-REAL-001',productName:'D1 Verified Cable',brand:'Test',category:'Electrical',unit:'Pcs',
        barcode:'D1-CB',sellingPrice:123,purchasePrice:80,currentStock:13,minimumStock:2,
        status:'Active',trackSerial:0,trackExpiry:0,trackWarranty:0,updatedAt:'2026-10-30'}
     ],categories:[],brands:[],units:[]});
     return route.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"API fixture route not configured"}'});
   });
   await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','CI-FAKE'));
   const page=await ctx.newPage();
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(host+'/#/app/pos-design-preview',{waitUntil:'domcontentloaded'});
   await page.locator('[data-pos-layout]').waitFor({timeout:20000});
   await page.getByText('D1 Verified Cable').first().waitFor({timeout:12000});
   assert.equal(await page.locator('[data-pos-layout] [data-cart-row="sale"]').count(),0,
    'API preview must start empty, not with seeded cart lines');
   assert.ok(!((await page.locator('[data-pos-layout]').innerText()).includes('Copper Wire 1.5')));
   assert.equal(calls.filter(c=>c.path==='/api/bootstrap').length,1,'source POS must load real D1 catalog once');
   await page.getByRole('button',{name:/D1 Verified Cable/}).first().click();
   await page.locator('[data-pos-layout] [data-cart-row="sale"]').first().waitFor({timeout:12000});
   assert.ok((await page.locator('[data-pos-layout] [data-cart-row="sale"]').first().innerText()).includes('D1 Verified Cable'),
     'original CartTable must receive the actual API-backed selected product');
   assert.equal(calls.filter(c=>c.method==='POST').length,0,'no fake sale posting');
   assert.deepEqual(errors,[],'browser errors must not occur');
   console.log('PASS original HisabIQ source POS API preview '+width+'px');
   await ctx.close();
 }
}finally{
 await browser?.close();
 server.kill('SIGTERM');
}
