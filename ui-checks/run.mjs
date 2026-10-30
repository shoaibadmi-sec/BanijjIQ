/**
 * GitHub UI checks for the pinned HisabIQ React build.
 * All business data is synthetic; all /api requests are intercepted.
 * Screenshots, layout data, accessibility reports and browser errors go to ui-checks/output.
 */
import assert from 'node:assert/strict';
import { runProductsHybridChecks } from './products-hybrid.mjs';
import { runFinalProductChecks } from './products-final.mjs';
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
const posMixedProduct={
 id:'PRD-MIXED-E2E',name:'Carton Test Cable',productName:'Carton Test Cable',
 brand:'',category:'Electrical',unit:'Pcs',barcode:'MIXED-E2E-001',
 sellingPrice:10,stock:400,minimumStock:5,trackSerial:false,trackExpiry:false,trackWarranty:false,
 unitProfilePreview:{baseUnit:'Pcs',revision:1,postingEnabled:true,units:[
  {unit:'Carton',symbol:'CT',containsNext:12,factor:240,sellingPrice:2100},
  {unit:'Box',symbol:'BOX',containsNext:20,factor:20,sellingPrice:180},
  {unit:'Pcs',symbol:'PCS',containsNext:null,factor:1,sellingPrice:10}
 ]}
};
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
  let postedPurchase=null;
  let returnedQty=0;
  let supplierDue=100;
  const supplierSettlements=[];
  return context.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    calls.push({method:request.method(),path});
    const respond=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(path==='/api/auth/me'&&request.method()==='GET')return respond({ok:true,user});
    if(path.startsWith('/api/purchases/unit-profile/')&&request.method()==='GET'){
      const productId=decodeURIComponent(path.slice('/api/purchases/unit-profile/'.length));
      if(productId==='PRD-000002')return respond({ok:true,productId,revision:1,postingEnabled:true,
        profile:{baseUnit:'Pcs',units:[
          {unit:'Carton',symbol:'CT',containsNext:12,factor:240,sellingPrice:2400},
          {unit:'Box',symbol:'BX',containsNext:20,factor:20,sellingPrice:200},
          {unit:'Pcs',symbol:'PCS',containsNext:null,factor:1,sellingPrice:20}
        ]}});
      return respond({ok:true,productId,revision:0,postingEnabled:true,profile:null});
    }
    if(path==='/api/purchases/supplier-settlements/supplier/SUP-UI-001'&&request.method()==='GET'){
      return respond({ok:true,supplier:{id:'SUP-UI-001',name:'Khan Hardware',
        currentDue:supplierDue},ledgerDue:supplierDue,needsReconciliation:false,
        activeSession:true,bankAccounts:[{id:'BANK-UI-1',name:'Bank test account',
         type:'Bank',currentBalance:500}],settlements:supplierSettlements});
    }
    if(path==='/api/purchases/supplier-settlements'&&request.method()==='POST'){
      const x=request.postDataJSON();
      assert.equal(x.supplierId,'SUP-UI-001');
      assert.ok(/^[0-9a-f-]{32,36}$/i.test(x.clientRequestId));
      assert.equal(x.method,'Cash');assert.equal(x.amount,40);
      assert.ok(x.amount<=supplierDue);
      supplierDue-=x.amount;
      const settlementId='SST-UI-001',ledgerId='LEDGER-UI-001';
      supplierSettlements.push({settlementId,requestId:x.clientRequestId,
       ledgerId,amount:x.amount,method:x.method,bankAccountId:'',date:'2026-10-30',
       status:'Posted',reversalLedgerId:'',createdAt:'2026-10-30'});
      calls.push({method:'ASSERT',path,body:x});
      return respond({ok:true,settlementId,ledgerId,amount:x.amount,newDue:supplierDue});
    }
    if(path==='/api/purchases/supplier-settlements/SST-UI-001/reverse'&&request.method()==='POST'){
      const x=request.postDataJSON();assert.ok(x.reason.length>=4);
      assert.equal(supplierSettlements.length,1);
      assert.equal(supplierSettlements[0].status,'Posted');
      supplierSettlements[0].status='Reversed';
      supplierSettlements[0].reversalLedgerId='REV-UI-001';
      supplierDue+=supplierSettlements[0].amount;
      calls.push({method:'ASSERT',path,body:x});
      return respond({ok:true,settlementId:'SST-UI-001',reversalLedgerId:'REV-UI-001',newDue:supplierDue});
    }
    if(path==='/api/purchases/supplier-search'&&request.method()==='GET'){
      const q=(url.searchParams.get('q')||'').toLowerCase();
      const supplier={id:'SUP-UI-001',name:'Khan Hardware',phone:'01700000001',
        currentDue:100,ledgerDue:100,needsReconciliation:false};
      return respond({ok:true,suppliers:['','khan','sup-ui-001','01700000001']
        .some(term=>term===q)||(q&&[supplier.name.toLowerCase(),supplier.phone,supplier.id.toLowerCase()].some(x=>x.includes(q)))
          ?[supplier]:[]});
    }
    if(path==='/api/purchases/PUR-UI-MIXED/return-data'&&request.method()==='GET'){
      const profile={baseUnit:'Pcs',units:[
       {unit:'Carton',symbol:'CT',containsNext:12,factor:240,sellingPrice:2400},
       {unit:'Box',symbol:'BX',containsNext:20,factor:20,sellingPrice:200},
       {unit:'Pcs',symbol:'PCS',containsNext:null,factor:1,sellingPrice:20}
      ]};
      return respond({ok:true,purchase:{
        purchaseId:'PUR-UI-MIXED',supplierId:'SUP-UI-001',supplierName:'Khan Hardware',
        grandTotal:2830,paidAmount:0,previouslyReturnedAmount:returnedQty*10,netPurchase:2830-returnedQty*10,
        items:[{productId:'PRD-000002',productName:'PVC Pipe 20mm',
          boughtQty:283,unitPrice:10,previouslyReturnedQty:returnedQty,
          availableQty:283-returnedQty,unitDescription:'1 CT 2 BX 3 PCS',
          returnSupported:true,unsupportedReason:'',originalLineTotal:2830,
          unitSnapshot:{revision:1,profile,quantities:{Carton:1,Box:2,Pcs:3},
            priceUnit:'Carton',enteredUnitPrice:2400,
            description:'1 CT 2 BX 3 PCS',sourceLotId:'LOT-UI-001'}}]
      }});
    }
    if(path==='/api/purchase-returns'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.equal(payload.purchaseId,'PUR-UI-MIXED');
      assert.equal(payload.refundMethod,'Supplier Credit');
      assert.ok(/^[0-9a-f-]{32,36}$/i.test(payload.clientRequestId));
      assert.equal(payload.items.length,1);
      assert.deepEqual(payload.items[0].unitQuantities,{Box:1,Pcs:2});
      returnedQty+=22;
      calls.push({method:'ASSERT',path:'/api/purchase-returns',payload});
      return respond({ok:true,returnId:'PRTN-UI-0001',totalReturnAmount:220});
    }
    if(path==='/api/purchases'&&request.method()==='GET')
      return respond({ok:true,purchases:postedPurchase?[postedPurchase]:[]});
    if(path==='/api/purchases'&&request.method()==='POST'){
      const data=request.postDataJSON();
      assert.equal(data.supplierId,'SUP-UI-001');
      assert.equal(data.paidAmount,0);
      assert.equal(data.items.length,1);
      if(data.items[0].unitQuantities){
        assert.equal(data.items[0].productId,'PRD-000002');
        assert.equal(data.items[0].unitProfileRevision,1);
        assert.deepEqual(data.items[0].unitQuantities,{Carton:1,Box:2,Pcs:3});
        assert.equal(data.items[0].priceUnit,'Carton');
        assert.equal(data.items[0].unitPrice,2400);
      }else{
        assert.equal(data.items[0].productId,'PRD-000001');
        assert.equal(data.items[0].qty,3);
        assert.equal(data.items[0].unitPrice,80);
      }
      calls.push({method:'ASSERT',path:'/api/purchases',payload:data});
      const amount=data.items[0].unitQuantities?2830:240;
      postedPurchase={purchaseId:data.items[0].unitQuantities?'PUR-UI-MIXED':'PUR-UI-0001',
        purchaseDate:'2026-10-30',supplierId:data.supplierId,supplierName:'Khan Hardware',
        grandTotal:amount,paidAmount:0,dueAmount:amount,paymentStatus:'Due',items:[]};
      return respond({ok:true,purchaseId:postedPurchase.purchaseId,grandTotal:amount,dueAmount:amount});
    }
    if(path==='/api/bootstrap'&&request.method()==='GET')return respond({ok:true,products:productData,
      categories:[{id:'CAT-ELEC',name:'Electrical'},{id:'CAT-HARD',name:'Hardware'}],
      brands:[{id:'BRAND-DEMO',name:'Demo Brand'}],units:[{id:'UNIT-PCS',name:'Pcs'}]});
    if(path==='/api/pos/bootstrap'&&request.method()==='GET')return respond({
      ok:true,products:[...posProducts,posMixedProduct],customers:[],bankAccounts:[],
      vendors:[{id:'VEN-UI-1',name:'UI Test Vendor',phone:'01000000111',currentDue:0,status:'Active'}],
      activeSession:{sessionId:'UI-E2E-SESSION',openedAt:'2026-10-28 09:00:00',openingCash:500},
      invoiceDesign:{settings:{'Shop Name':'UI Fixture Shop','Shop Name Bangla':'টেস্ট দোকান',
        'Address':'Fixture address, Rajshahi','Phone 1':'01000000000',
        'Invoice Footer':'Test receipt only'},logoDataUri:''}
    });
    if(path==='/api/pos/sales'&&request.method()==='POST'){
      const posted=request.postDataJSON();
      assert.ok(['PRD-000001','PRD-000002','PRD-000003','PRD-MIXED-E2E'].includes(posted.items[0]?.productId));
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
    if(path==='/api/sales-returns/search'&&url.searchParams.get('q')?.includes('MIXED'))
      return respond({ok:true,matches:[{invoiceId:'UI-E2E-MIXED',date:'2026-10-28',
        customerName:'Unit Return Buyer',customerPhone:'01000000011',grandTotal:2490,
        paymentStatus:'Paid',returnStatus:'No Return'}]});
    if(path==='/api/sales-management/UI-E2E-MIXED/reverse'&&request.method()==='GET')
      return respond({ok:true,preview:{eligible:true,reason:'',invoiceId:'UI-E2E-MIXED',
        refundAmount:2300,previouslyRefundedAmount:190,remainingBaseQuantity:262,
        items:[{productId:'PRD-MIXED-E2E',qty:262,unitPrice:0,
          unitQuantities:{Carton:1,Box:1,Pcs:2}}]}});
    if(path==='/api/sales-management/UI-E2E-MIXED/reverse'&&request.method()==='POST'){
      const payload=request.postDataJSON();
      assert.ok(payload.reason.length>=8);
      calls.push({method:'ASSERT',path,payload});
      return respond({ok:true,returnId:'SRT-UI-REVERSE-0001',totalReturnAmount:2300});
    }
    if(path==='/api/sales-returns/UI-E2E-MIXED/data'&&request.method()==='GET')
      return respond({ok:true,sale:{invoiceId:'UI-E2E-MIXED',date:'2026-10-28',
        customerId:'CUS-MIXED',customerName:'Unit Return Buyer',customerPhone:'01000000011',
        grandTotal:2490,paidAmount:2490,dueAmount:0,previouslyReturnedAmount:0,netSale:2490,
        items:[{productId:'PRD-MIXED-E2E',name:'Carton Test Cable',soldQty:283,vendorQty:0,
          previouslyReturnedQty:0,availableQty:283,unitPrice:2490/283,
          trackSerial:false,trackExpiry:false,trackWarranty:false,availableSerials:[],
          mixedUnit:{description:'1 CT 2 BOX 3 PCS',netPriceFactor:1,
            originalQuantities:{Carton:1,Box:2,Pcs:3},availableQuantities:{Carton:1,Box:2,Pcs:3},
            profile:posMixedProduct.unitProfilePreview}}]}} );
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
      if(payload.invoiceId==='UI-E2E-MIXED'){
        assert.equal(payload.items[0].qty,21);
        assert.deepEqual(payload.items[0].unitQuantities,{Box:1,Pcs:1});
        calls.push({method:'ASSERT',path:'/api/sales-returns',payload});
        return respond({ok:true,returnId:'SRT-UI-MIXED-001',totalReturnAmount:190});
      }
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
  const serious=report.violations.filter(x=>['critical','serious'].includes(x.impact));
  assert.equal(serious.length,0,label+' contains critical/serious accessibility violations: '+JSON.stringify(serious));
}
async function inspectLayout(page,label){
  const info=await page.evaluate(()=>{
    const root=document.querySelector('[data-live-products], [data-live-pos], [data-live-purchases], [data-live-purchase-editor]');
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
        await audit(page,'products-'+width+'-'+theme);
        if(width===390&&theme==='light'){
          const search=page.getByRole('textbox',{name:'Search products'});
          await search.fill('Copper');
          assert.equal(await page.locator('[data-live-products] tbody tr').count(),1);
          await page.getByRole('button',{name:'Clear Search products',exact:true}).click();
          assert.equal(await page.locator('[data-live-products] tbody tr').count(),3);
          await page.getByRole('button',{name:/Add product/i}).click();
          await page.locator('[data-live-product-editor]').waitFor();
          await screenshot(page,'product-editor-390');
        }
        results.apiCalls.push(...api);
        await ctx.close();
      });
    }
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4A supplier search + due purchase '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];
      await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('purchase '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases/new');
      await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
      const supplier=page.getByRole('combobox',{name:'Search supplier name, phone or ID'});
      await supplier.fill('Khan');
      await page.getByRole('option',{name:/Khan Hardware/}).click();
      await page.getByText(/Existing due/).waitFor();
      assert.ok((await page.locator('[data-live-purchase-editor]').innerText()).includes('100'));
      await page.getByRole('combobox',{name:'Product'}).selectOption('PRD-000001');
      await page.getByRole('spinbutton',{name:'Purchase quantity'}).fill('3');
      await page.getByRole('spinbutton',{name:'Purchase unit cost'}).fill('80');
      await inspectLayout(page,'phase4-purchase-entry-'+width);
      await screenshot(page,'phase4-purchase-entry-'+width);
      if(width===390)await audit(page,'phase4-purchase-entry-390');
      await page.getByRole('button',{name:/Confirm Due Purchase/}).click();
      await page.locator('[data-live-purchases]').waitFor({timeout:12000});
      await page.getByText('PUR-UI-0001').waitFor();
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/purchases').length,1);
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/purchases').length,1);
      results.apiCalls.push(...calls);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4B joined 3-unit purchase and price unit '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('phase4b '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases/new');
      await page.locator('[data-live-purchase-editor]').waitFor({timeout:12000});
      await page.getByRole('combobox',{name:'Search supplier name, phone or ID'}).fill('Khan');
      await page.getByRole('option',{name:/Khan Hardware/}).click();
      await page.getByRole('combobox',{name:'Product'}).selectOption('PRD-000002');
      await page.locator('[data-multi-quantity]').waitFor({timeout:10000});
      await page.getByRole('textbox',{name:'Quantity in Carton for PVC Pipe 20mm'}).fill('1');
      await page.getByRole('textbox',{name:'Quantity in Box for PVC Pipe 20mm'}).fill('2');
      await page.getByRole('textbox',{name:'Quantity in Pcs for PVC Pipe 20mm'}).fill('3');
      await page.getByRole('combobox',{name:'Purchase price unit'}).selectOption('Carton');
      await page.getByRole('spinbutton',{name:'Purchase unit cost'}).fill('2400');
      assert.ok((await page.locator('[data-live-purchase-editor]').innerText()).includes('2,830'));
      await inspectLayout(page,'phase4b-mixed-purchase-'+width);
      await screenshot(page,'phase4b-mixed-purchase-'+width);
      if(width===390)await audit(page,'phase4b-mixed-purchase-390');
      await page.getByRole('button',{name:/Confirm Due Purchase/}).click();
      await page.locator('[data-live-purchases]').waitFor({timeout:12000});
      await page.getByText('PUR-UI-MIXED').waitFor();
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/purchases').length,1);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4C original-cost partial purchase return '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('phase4c '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases?tab=return&purchaseId=PUR-UI-MIXED');
      await page.locator('[data-live-purchase-returns]').waitFor({timeout:12000});
      await page.getByText('PVC Pipe 20mm').waitFor();
      await page.getByRole('textbox',{name:'Quantity in Box for PVC Pipe 20mm'}).fill('1');
      await page.getByRole('textbox',{name:'Quantity in Pcs for PVC Pipe 20mm'}).fill('2');
      await page.getByPlaceholder('Why are you returning the goods?').fill('Quality inspection');
      await page.getByText(/Original purchase-cost credit/).waitFor();
      assert.ok((await page.locator('[data-live-purchase-returns]').innerText()).includes('220'));
      await screenshot(page,'phase4c-purchase-return-'+width);
      if(width===390)await audit(page,'phase4c-purchase-return-390');
      await page.getByRole('button',{name:/Confirm Purchase Return/}).click();
      await page.getByText(/Purchase return saved/).waitFor({timeout:12000});
      assert.equal(calls.filter(c=>c.method==='ASSERT'&&c.path==='/api/purchase-returns').length,1);
      results.apiCalls.push(...calls);
      await ctx.close();
    });
  }
  for(const width of [390,768,1440]){
    await withCheck('Phase 4D supplier payment and reversal '+width,async()=>{
      const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
      const calls=[];await startMocking(ctx,calls);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('phase4d '+width+': '+e.message));
      await page.goto(base+'/#/app/purchases?tab=payments&supplierId=SUP-UI-001');
      await page.locator('[data-live-supplier-settlements]').waitFor({timeout:12000});
      await page.getByText('Current due · বাকি:').waitFor({timeout:12000});
      await page.getByRole('spinbutton',{name:'Supplier payment amount'}).fill('40');
      await page.getByRole('combobox',{name:'Supplier payment method'}).selectOption('Cash');
      await inspectLayout(page,'phase4d-supplier-payment-'+width);
      await screenshot(page,'phase4d-supplier-payment-'+width);
      if(width===390)await audit(page,'phase4d-supplier-payment-390');
      await page.getByRole('button',{name:/Confirm Payment/}).click();
      await page.getByText(/Payment saved · SST-UI-001/).waitFor({timeout:12000});
      await page.getByRole('button',{name:/Reverse ·/}).click();
      await page.getByRole('textbox',{name:'Supplier payment reversal reason'}).fill('Entered wrong payout');
      await page.getByRole('button',{name:'Confirm reversal'}).click();
      await page.getByText(/Reversal recorded · REV-UI-001/).waitFor({timeout:12000});
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path==='/api/purchases/supplier-settlements').length,1);
      assert.equal(calls.filter(x=>x.method==='ASSERT'&&x.path.endsWith('/reverse')).length,1);
      results.apiCalls.push(...calls);await ctx.close();
    });
  }
  await runProductsHybridChecks({browser,base,withCheck,results});
  await runFinalProductChecks({browser,base,withCheck,results});
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
      // Source: pinned HisabIQ src/components/pos/CartTable.tsx.
      // The original seven-column header and product picker share one grid.
      const sourceCart=page.locator('[data-live-pos] [data-cart-kind="sale"]');
      assert.equal(await sourceCart.locator('[data-cart-header]').count(),1,
        'Restore the original HisabIQ cart header instead of a detached toolbar');
      assert.equal(await sourceCart.locator('[data-testid="pos-cart"]').count(),1);
      assert.equal(await sourceCart.locator('[data-testid="pos-add-row"]').count(),1,
        'Product search belongs in the original HisabIQ add-row');
      assert.equal(await sourceCart.locator('[data-cart-header] > *').count(),7,
        'Original cart has #, Product, Quantity, Price In, Price, Total, Remove');
      assert.equal(await sourceCart.locator('[data-testid="pos-add-row"] input').count(),1,
        'One embedded product search, not a second detached form');
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
      assert.equal(await page.locator('[data-testid="pos-cart"] [data-pos-line]').count(),1,
        'Live selected product renders in the original HisabIQ cart grid');
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
  for(const width of [390,768,1440]){
    await withCheck('mixed-unit joined quantity '+width+' layout and posting',async()=>{
      const ctx=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
      const api=[];await startMocking(ctx,api);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();
      page.on('pageerror',e=>results.consoleErrors.push('mixed '+width+': '+e.message));
      await page.goto(base+'/#/app/pos',{waitUntil:'domcontentloaded'});
      await page.locator('[data-live-pos]').waitFor();
      await page.locator('[data-live-pos] button').filter({hasText:'Carton Test Cable'}).first().click();
      const line=page.locator('[data-pos-line]').filter({hasText:'Carton Test Cable'});
      const inputs=line.locator('[data-multi-quantity] input');
      await inputs.first().waitFor();
      assert.equal(await inputs.count(),3);
      await inputs.nth(0).fill('1');await inputs.nth(1).fill('2');await inputs.nth(2).fill('3');
      assert.ok((await line.textContent()).includes('2,490'),'mixed prices remain independent');
      const tops=await inputs.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
      assert.ok(tops.every(top=>Math.abs(top-tops[0])<2),'one compact horizontal quantity line');
      await screenshot(page,'phase3b-mixed-quantity-'+width);
      await page.locator('input[list="live-pos-customer-names"]').fill('UI Unit Buyer');
      await page.locator('input[list="live-pos-customer-phones"]').fill('01000009123');
      await page.getByRole('spinbutton',{name:/Amount received/}).fill('2490');
      await page.getByRole('button',{name:'Review and post real sale'}).click();
      await page.getByRole('button',{name:'Confirm and post'}).click();
      await page.getByText('Sale posted successfully').waitFor({timeout:12000});
      const posted=api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload;
      assert.equal(posted.items[0].qty,283);
      assert.equal(posted.items[0].unitProfileRevision,1);
      assert.deepEqual(posted.items[0].unitQuantities,{Carton:1,Box:2,Pcs:3});
      assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/pos/sales').length,1);
      results.apiCalls.push(...api);await ctx.close();
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
  await withCheck('vendor shortage uses live vendor ID and exact agreed cost',async()=>{
    const ctx=await browser.newContext({viewport:{width:1024,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/pos');await page.locator('[data-live-pos]').waitFor();
    await page.locator('[data-live-pos] button').filter({hasText:'PVC Pipe 20mm'}).first().click();
    await page.getByRole('spinbutton',{name:'Quantity for PVC Pipe 20mm'}).fill('5');
    await page.getByRole('button',{name:'Resolve stock shortage'}).click();
    await page.getByRole('radio',{name:/Vendor/}).click();
    await page.getByRole('textbox',{name:'New vendor name'}).fill('UI Quick Vendor');
    await page.getByRole('textbox',{name:'New vendor phone'}).fill('01000000222');
    await page.getByRole('button',{name:'+ Add & select vendor'}).click();
    await page.getByRole('combobox',{name:'Select live vendor'}).selectOption('VEN-UI-2');
    await page.getByRole('spinbutton',{name:'Vendor unit cost'}).fill('35');
    await page.getByRole('button',{name:'Use vendor'}).click();
    await page.locator('input[list="live-pos-customer-names"]').fill('UI Vendor Buyer');
    await page.locator('input[list="live-pos-customer-phones"]').fill('01000000003');
    await page.getByRole('spinbutton',{name:/Amount received/}).fill('275');
    await page.getByRole('button',{name:'Review and post real sale'}).click();
    await page.getByRole('button',{name:'Confirm and post'}).click();
    await page.getByText('Sale posted successfully').waitFor({timeout:12000});
    const payload=api.find(x=>x.method==='ASSERT'&&x.path==='/api/pos/sales')?.payload;
    assert.equal(payload.items[0].fulfillmentMode,'vendor');
    assert.equal(payload.items[0].vendorId,'VEN-UI-2');
    assert.equal(api.filter(x=>x.path==='/api/pos/vendors'&&x.method==='POST').length,1);
    assert.equal(payload.items[0].vendorUnitCost,35);
    results.apiCalls.push(...api);await screenshot(page,'phase13-pos-vendor-1024');
    await ctx.close();
  });
  for(const width of [390,768,1440]){
    await withCheck('mixed-unit partial return '+width+' historical prices and compact UI',async()=>{
      const ctx=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
      const api=[];await startMocking(ctx,api);
      await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
      const page=await ctx.newPage();page.on('dialog',dialog=>void dialog.accept());
      await page.goto(base+'/#/app/live-sales-returns');await page.locator('[data-live-sales-returns]').waitFor();
      await page.getByRole('textbox',{name:'Search saved invoices'}).fill('MIXED');
      await page.getByRole('button',{name:'Search',exact:true}).click();
      await page.getByRole('button',{name:/UI-E2E-MIXED/}).click();
      await page.getByRole('spinbutton',{name:'Return Box for Carton Test Cable'}).fill('1');
      await page.getByRole('spinbutton',{name:'Return Pcs for Carton Test Cable'}).fill('1');
      const panel=page.locator('[data-live-sales-returns]');
      assert.ok((await panel.innerText()).includes('190'),'exact original Box+Pcs historical refund');
      await screenshot(page,'phase3c-mixed-unit-return-'+width);
      await page.getByPlaceholder('Why was this returned?').fill('Partial return');
      await page.getByRole('button',{name:'Review real return'}).click();
      await page.getByRole('button',{name:'Confirm & refund'}).click();
      await page.getByText('SRT-UI-MIXED-001').waitFor({timeout:12000});
      assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-returns').length,1);
      results.apiCalls.push(...api);await ctx.close();
    });
  }
  await withCheck('mixed full invoice reversal requires preview, reason, explicit cashier confirmation',async()=>{
    const ctx=await browser.newContext({viewport:{width:768,height:960},reducedMotion:'reduce'});
    const api=[];await startMocking(ctx,api);
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
    const page=await ctx.newPage();
    page.on('dialog',d=>void d.accept());
    await page.goto(base+'/#/app/live-sales-returns');
    await page.locator('[data-live-sales-returns]').waitFor();
    await page.getByRole('textbox',{name:'Search saved invoices'}).fill('MIXED');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:/UI-E2E-MIXED/}).click();
    await page.locator('[data-mixed-full-reversal]').waitFor();
    await page.getByRole('button',{name:'Check full reversal'}).click();
    await page.getByText(/Remaining: 1 lines/).waitFor();
    await page.getByText(/Already refunded:/).waitFor();
    const reversalButton=page.getByRole('button',{name:'Review and reverse entire invoice'});
    assert.equal(await reversalButton.isDisabled(),true);
    await page.getByRole('textbox',{name:'Full invoice reversal reason'}).fill('Original customer requested a corrected sale');
    await screenshot(page,'phase3d-full-invoice-reversal');
    await reversalButton.click();
    await page.getByText('SRT-UI-REVERSE-0001').waitFor({timeout:12000});
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-management/UI-E2E-MIXED/reverse').length,1);
    assert.equal(api.filter(x=>x.method==='POST'&&x.path==='/api/sales-returns').length,0);
    assert.equal(api.filter(x=>x.method==='ASSERT'&&x.path==='/api/sales-management/UI-E2E-MIXED/reverse').length,1);
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
