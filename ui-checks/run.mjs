/**
 * GitHub UI checks for the pinned HisabIQ React build.
 * All business data is synthetic; all /api requests are intercepted.
 * Screenshots, layout data, accessibility reports and browser errors go to ui-checks/output.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root=resolve(process.cwd()), web=join(root,'.generated/hisabiq-web');
const require=createRequire(pathToFileURL(join(web,'package.json')));
const { chromium }=require('playwright');
const out=join(root,'ui-checks/output');
mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:4173';
const productData=[
 {productId:'PRD-000001',productName:'Copper Cable 2.5mm',displayName:'Copper Cable 2.5mm',
  brand:'Demo Brand',category:'Electrical',unit:'Pcs',barcode:'UI-E2E-001',
  purchasePrice:80,sellingPrice:120,currentStock:25,sellableStock:25,minimumStock:5,
  trackSerial:0,trackExpiry:0,trackWarranty:0,status:'Active',updatedAt:'2026-10-28 12:00:00'},
 {productId:'PRD-000002',productName:'PVC Pipe 20mm',displayName:'PVC Pipe 20mm',
  brand:'Demo Brand',category:'Hardware',unit:'Pcs',barcode:'UI-E2E-002',
  purchasePrice:35,sellingPrice:55,currentStock:3,sellableStock:3,minimumStock:5,
  trackSerial:0,trackExpiry:0,trackWarranty:0,status:'Active',updatedAt:'2026-10-28 12:00:00'},
 {productId:'PRD-000003',productName:'Serial Tracked Motor',displayName:'Serial Tracked Motor',
  brand:'Demo Brand',category:'Electrical',unit:'Pcs',barcode:'UI-E2E-003',
  purchasePrice:500,sellingPrice:700,currentStock:2,sellableStock:2,minimumStock:1,
  trackSerial:1,trackExpiry:0,trackWarranty:1,status:'Active',updatedAt:'2026-10-28 12:00:00'}
];
const user={userId:'UI-E2E-ADMIN',fullName:'UI Test Administrator',
  phone:'01000000000',role:'admin',permissions:{
    products:{view:true,add:true,edit:true},pos:{view:true,add:true,edit:true},
    returns:{view:true,add:true,edit:true}}};
const posProducts=productData.map(p=>({
  id:p.productId,name:p.productName,productName:p.productName,brand:p.brand,category:p.category,
  unit:p.unit,barcode:p.barcode,sellingPrice:p.sellingPrice,stock:p.sellableStock,
  minimumStock:p.minimumStock,trackSerial:Boolean(p.trackSerial),trackExpiry:false,
  trackWarranty:Boolean(p.trackWarranty)
}));
const invoice={invoiceId:'UI-E2E-INV-001',date:'2026-10-28',
 customerName:'Test Customer',customerPhone:'01000000001',
 customerFatherName:'',customerAddress:'',subtotal:120,discount:0,
 grandTotal:120,paidAmount:120,dueAmount:0,paymentStatus:'Paid',paymentMethod:'Cash',
 items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',quantity:1,
   unit:'Pcs',unitPrice:120,lineTotal:120}]};
const results={startedAt:new Date().toISOString(),passed:[],failed:[],warnings:[],screenshots:[],
  accessibility:[],layouts:[],consoleErrors:[],apiCalls:[]};
const safe=(name)=>name.replace(/[^a-z0-9-]/gi,'-').toLowerCase();
async function waitForServer(proc){
  for(let i=0;i<70;i++){
    if(proc.exitCode!==null)throw new Error('Vite preview exited before serving: '+proc.exitCode);
    try{const r=await fetch(base+'/');if(r.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  throw new Error('Timed out starting React preview');
}
async function withCheck(name,fn){
  try{await fn();results.passed.push(name);process.stdout.write('PASS '+name+'\n');}
  catch(error){results.failed.push({name,error:String(error?.stack||error)});
    process.stderr.write('FAIL '+name+': '+String(error?.message||error)+'\n');}
}
function startMocking(context,calls){
  return context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    calls.push({method:request.method(),path});
    const respond=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(path==='/api/auth/me'&&request.method()==='GET')return respond({ok:true,user});
    if(path==='/api/bootstrap'&&request.method()==='GET')return respond({ok:true,products:productData});
    if(path==='/api/pos/bootstrap'&&request.method()==='GET')return respond({
      ok:true,products:posProducts,customers:[],bankAccounts:[],
      vendors:[{id:'VEN-UI-1',name:'UI Test Vendor',phone:'01000000111',currentDue:0,status:'Active'}],
      activeSession:{sessionId:'UI-E2E-SESSION',openedAt:'2026-10-28 09:00:00',openingCash:500},
      invoiceDesign:{settings:{'Shop Name':'UI Fixture Shop','Shop Name Bangla':'টেস্ট দোকান',
        'Address':'Fixture address, Rajshahi','Phone 1':'01000000000',
        'Invoice Footer':'Test receipt only'},logoDataUri:''}
    });
    if(path==='/api/pos/sales'&&request.method()==='POST'){
      const posted=request.postDataJSON();
      assert.ok(['PRD-000001','PRD-000002','PRD-000003'].includes(posted.items[0]?.productId));
      if(posted.items[0]?.productId==='PRD-000003')
        assert.deepEqual(posted.items[0].serialNumbers,['SN-UI-001']);
      calls.push({method:'ASSERT',path:'/api/pos/sales',payload:posted});
      return respond({ok:true,invoice});
    }
    if(path==='/api/pos/invoices/UI-E2E-INV-001'&&request.method()==='GET')
      return respond({ok:true,invoice});
    if(path.startsWith('/api/pos/products/')&&path.endsWith('/tracking-options')&&request.method()==='GET')
      return respond({ok:true,serials:[{serialNumber:'SN-UI-001'}]});
    if(path==='/api/pos/vendors'&&request.method()==='POST')
      return respond({ok:true,vendor:{id:'VEN-UI-2',name:request.postDataJSON().name,
        phone:request.postDataJSON().phone,currentDue:0,status:'Active'}});
    if(path==='/api/sales-returns/search'&&request.method()==='GET')
      return respond({ok:true,matches:[{invoiceId:'UI-E2E-RET-INVOICE',date:'2026-10-28',
        customerName:'UI Return Buyer',customerPhone:'01000000001',grandTotal:700,
        paymentStatus:'Paid',returnStatus:'No Return'}]});
    if(path==='/api/sales-returns/UI-E2E-RET-INVOICE/data'&&request.method()==='GET')
      return respond({ok:true,sale:{invoiceId:'UI-E2E-RET-INVOICE',date:'2026-10-28',
        customerId:'CUS-UI',customerName:'UI Return Buyer',customerPhone:'01000000001',
        grandTotal:700,paidAmount:700,dueAmount:0,previouslyReturnedAmount:0,
        netSale:700,items:[{productId:'PRD-000003',name:'Serial Tracked Motor',
          soldQty:1,vendorQty:0,previouslyReturnedQty:0,availableQty:1,unitPrice:700,
          trackSerial:true,trackExpiry:false,trackWarranty:true,availableSerials:['SN-UI-001']}]}} );
    if(path==='/api/sales-returns'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.equal(payload.invoiceId,'UI-E2E-RET-INVOICE');
      assert.deepEqual(payload.items[0].serialNumbers,['SN-UI-001']);
      calls.push({method:'ASSERT',path:'/api/sales-returns',payload});
      return respond({ok:true,returnId:'SRT-UI-E2E-001',totalReturnAmount:700});
    }
    if(path==='/api/sales-returns'&&request.method()==='GET')
      return respond({ok:true,returns:[]});
    if(path==='/api/pos/sales-by-phone'&&request.method()==='GET')
      return respond({ok:true,sales:[]});
    // Unknown requests intentionally fail closed; never reach a live backend.
    results.warnings.push('Blocked unexpected API call: '+request.method()+' '+path);
    return route.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"Unmocked UI-check API request"}'});
  });
}
async function screenshot(page,label){
  const file=safe(label)+'.png';
  await page.screenshot({path:join(out,file),fullPage:true,animations:'disabled'});
  results.screenshots.push(file);
}
async function audit(page,label){
  const axePath=join(web,'node_modules/axe-core/axe.min.js');
  if(!existsSync(axePath))throw new Error('axe-core dependency missing from source');
  await page.addScriptTag({content:readFileSync(axePath,'utf8')});
  const report=await page.evaluate(async()=>{
    const r=await window.axe.run(document.querySelector('[data-live-products], [data-live-pos]')||document.body,
      {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
    return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,
      nodes:v.nodes.slice(0,5).map(n=>({target:n.target,summary:n.failureSummary}))})),
      passes:r.passes.length,incomplete:r.incomplete.length};
  });
  results.accessibility.push({label,...report});
  // New screens should have no critical errors. Other detected issues are captured
  // as structured artifact findings instead of silently hidden or modifying the design.
  const critical=report.violations.filter(x=>x.impact==='critical');
  assert.equal(critical.length,0,label+' contains critical accessibility violations');
}
async function inspectLayout(page,label){
  const info=await page.evaluate(()=>{
    const root=document.querySelector('[data-live-products], [data-live-pos]');
    const rect=root?.getBoundingClientRect();
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
      workspaceWidth:rect?.width||0,workspaceLeft:rect?.left||0,
      productRows:document.querySelectorAll('[data-live-products] tbody tr').length,
      screen:location.hash};
  });
  results.layouts.push({label,...info});
  assert.ok(info.workspaceWidth>150,label+' workspace should render');
  // The cart and table may scroll internally; the whole document must fit.
  if(info.documentWidth>info.viewport+3)
    results.warnings.push(label+': document overflows by '+(info.documentWidth-info.viewport)+'px');
}
const server=spawn(process.execPath,[join(web,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','4173','--strictPort'],
 {cwd:web,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1'}});
let serverLogs='';
for(const stream of [server.stdout,server.stderr])stream.on('data',c=>serverLogs+=String(c).slice(-2000));
let browser;
try{
  await waitForServer(server);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  await withCheck('unauthenticated route stays behind real sign-in',async()=>{
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/products');
    await page.getByText('Sign in · BanijjIQ').waitFor({timeout:10000});
    assert.equal(await page.locator('[data-live-products]').count(),0);
    await screenshot(page,'auth-390');
    await ctx.close();
  });
  for(const width of [390,768,1024,1440]){
    for(const theme of ['light','dark']){
      await withCheck('products '+width+' '+theme,async()=>{
        const ctx=await browser.newContext({viewport:{width,height:900},
          colorScheme:theme,reducedMotion:'reduce',deviceScaleFactor:1});
        const api=[];
        await startMocking(ctx,api);
        await ctx.addInitScript(({theme})=>{
          localStorage.setItem('shererp_auth_token','ui-e2e-only-token');
          localStorage.setItem('hisabiq-theme',theme);
        },{theme});
        const page=await ctx.newPage();
        page.on('pageerror',e=>results.consoleErrors.push('products '+width+': '+e.message));
        await page.goto(base+'/#/app/products',{waitUntil:'domcontentloaded'});
        await page.locator('[data-live-products]').waitFor({timeout:10000});
        await page.getByText('Copper Cable 2.5mm').first().waitFor({timeout:10000});
        await inspectLayout(page,'products-'+width+'-'+theme);
        await screenshot(page,'products-'+width+'-'+theme);
        if(width===390&&theme==='light'){
          await audit(page,'products-390-light');
          const search=page.getByRole('textbox',{name:'Search real products'});
          await search.fill('Copper');
          assert.equal(await page.locator('[data-live-products] tbody tr').count(),1);
          await page.getByRole('button',{name:'Clear Search real products',exact:true}).click();
          assert.equal(await page.locator('[data-live-products] tbody tr').count(),3);
          await page.getByRole('button',{name:'Add Product'}).click();
          await page.locator('[data-live-product-editor]').waitFor();
          await screenshot(page,'product-editor-390');
        }
        results.apiCalls.push(...api);
        await ctx.close();
      });
    }
  }
  for(const width of [390,768,1440]){
    await withCheck('pos '+width+' light',async()=>{
      const ctx=await browser.newContext({viewport:{width,height:960},
        reducedMotion:'reduce',deviceScaleFactor:1});
      const api=[];
      await startMocking(ctx,api);
      await ctx.addInitScript(()=>{
        localStorage.setItem('shererp_auth_token','ui-e2e-only-token');
        localStorage.setItem('hisabiq-theme','light');
      });
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('pos '+width+': '+e.message));
      await page.goto(base+'/#/app/pos',{waitUntil:'domcontentloaded'});
      await page.locator('[data-live-pos]').waitFor({timeout:10000});
      await page.getByText('Copper Cable 2.5mm').first().waitFor({timeout:10000});
      await inspectLayout(page,'pos-'+width+'-light');
      await screenshot(page,'pos-'+width+'-light');
      if(width===390)await audit(page,'pos-390-light');
      // Explicit keyboard focus contract, then add a regular non-tracked item.
      await page.keyboard.press('F2');
      assert.ok(await page.locator('input:focus').count()>=1,'F2 should focus the product picker');
      await page.keyboard.press('Escape'); // Close open source-authentic combobox before tapping quick item.
      const quick=page.locator('[data-live-pos] button').filter({hasText:'Copper Cable 2.5mm'}).first();
      await quick.click();
      await page.getByRole('spinbutton',{name:'Quantity for Copper Cable 2.5mm'}).waitFor();
      await screenshot(page,'pos-cart-'+width);
      if(width===1440){
        const [name,phone]=[
          page.locator('input[list="live-pos-customer-names"]'),
          page.locator('input[list="live-pos-customer-phones"]')
        ];
        await name.fill('Test Customer');
        await phone.fill('01000000001');
        await page.getByRole('spinbutton',{name:/Amount received/}).fill('120');
        await page.getByRole('button',{name:'Review and post real sale'}).click();
        await page.getByRole('button',{name:'Confirm and post'}).click();
        await page.getByText('Sale posted successfully').waitFor({timeout:12000});
        assert.equal(api.filter(x=>x.path==='/api/pos/sales'&&x.method==='POST').length,1);
        await page.getByRole('button',{name:'View / Print receipt'}).click();
        await page.locator('#hisabiq-real-receipt').waitFor();
        await screenshot(page,'pos-saved-receipt-1440');
      }
      results.apiCalls.push(...api);
      await ctx.close();
    });
  }
  await withCheck('tracked serial POS selects backend eligible IMEI and posts once',async()=>{
    const ctx=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/pos');
    await page.locator('[data-live-pos]').waitFor();
    await page.locator('[data-live-pos] button').filter({hasText:'Serial Tracked Motor'}).first().click();
    await page.getByRole('button',{name:/Serial \/ IMEI/}).click();
    await page.getByRole('button',{name:/SN-UI-001/}).click();
    await page.getByRole('button',{name:'Use serials'}).click();
    await page.locator('input[list="live-pos-customer-names"]').fill('UI Tracking Buyer');
    await page.locator('input[list="live-pos-customer-phones"]').fill('01000000001');
    await page.getByRole('spinbutton',{name:/Amount received/}).fill('700');
    await page.getByRole('button',{name:'Review and post real sale'}).click();
    await page.getByRole('button',{name:'Confirm and post'}).click();
    await page.getByText('Sale posted successfully').waitFor({timeout:12000});
    assert.equal(api.filter(x=>x.path==='/api/pos/sales'&&x.method==='POST').length,1);
    assert.equal(api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload.items[0].productId,'PRD-000003');
    await screenshot(page,'phase13-pos-serial-1440');
    results.apiCalls.push(...api);await ctx.close();
  });
  await withCheck('shortage dialog explicitly chooses negative sourcing',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/pos');await page.locator('[data-live-pos]').waitFor();
    await page.locator('[data-live-pos] button').filter({hasText:'PVC Pipe 20mm'}).first().click();
    await page.getByRole('spinbutton',{name:'Quantity for PVC Pipe 20mm'}).fill('5');
    await page.getByRole('button',{name:'Resolve stock shortage'}).click();
    await page.getByRole('radio',{name:/Negative Sale/}).click();
    await page.getByRole('button',{name:'Allow negative sale'}).click();
    await page.locator('input[list="live-pos-customer-names"]').fill('UI Shortage Buyer');
    await page.locator('input[list="live-pos-customer-phones"]').fill('01000000002');
    await page.getByRole('spinbutton',{name:/Amount received/}).fill('275');
    await page.getByRole('button',{name:'Review and post real sale'}).click();
    await page.getByRole('button',{name:'Confirm and post'}).click();
    await page.getByText('Sale posted successfully').waitFor({timeout:12000});
    const payload=api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload;
    assert.equal(payload.items[0].fulfillmentMode,'negative');
    assert.equal(payload.items[0].qty,5);
    await screenshot(page,'phase13-pos-shortage-768');
    results.apiCalls.push(...api);await ctx.close();
  });
  await withCheck('Sales Return uses saved invoice/serial and posts one real return',async()=>{
    const ctx=await browser.newContext({viewport:{width:390,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();page.on('dialog',d=>void d.accept());
    await page.goto(base+'/#/app/live-sales-returns');
    await page.locator('[data-live-sales-returns]').waitFor({timeout:10000});
    await page.getByRole('textbox',{name:'Search saved invoices'}).fill('UI-E2E-RET-INVOICE');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:/UI-E2E-RET-INVOICE/}).click();
    await page.getByRole('spinbutton',{name:'Return quantity for Serial Tracked Motor'}).fill('1');
    await page.getByRole('button',{name:/Serial \/ IMEI/}).click();
    await page.getByRole('button',{name:/SN-UI-001/}).click();
    await page.getByRole('button',{name:'Use serials'}).click();
    await page.getByPlaceholder('Why was this returned?').fill('Damaged after sale');
    await page.getByRole('button',{name:'Review real return'}).click();
    await page.getByRole('button',{name:'Confirm & refund'}).click();
    await page.getByText('SRT-UI-E2E-001').waitFor({timeout:12000});
    assert.equal(api.filter(x=>x.path==='/api/sales-returns'&&x.method==='POST').length,1);
    await screenshot(page,'phase13-sales-return-390');
    results.apiCalls.push(...api);await ctx.close();
  });
}finally{
  try{await browser?.close()}catch{}
  server.kill('SIGTERM');
  results.finishedAt=new Date().toISOString();
  writeFileSync(join(out,'ui-check-results.json'),JSON.stringify(results,null,2));
  writeFileSync(join(out,'server.log'),serverLogs.slice(-10000));
}
process.stdout.write('UI checks: '+results.passed.length+' passed / '+results.failed.length+' failed; '+
  results.screenshots.length+' screenshots; '+results.accessibility.length+' accessibility audits.\n');
if(results.consoleErrors.length)results.failed.push({name:'Browser runtime errors',error:results.consoleErrors.join('\n')});
if(results.failed.length)process.exitCode=1;
