import assert from 'node:assert/strict';

export async function runPurchaseInvoiceSourceChecks({browser,base,withCheck,results,startMocking,screenshot,audit}){
 const invoice={purchaseId:'PUR-LIVE-SOURCE-001',purchaseDate:'2026-10-30',
  supplierId:'SUP-UI-001',supplierName:'Khan Hardware',status:'Completed',
  grandTotal:100,paidAmount:40,dueAmount:60,returnedAmount:0,paymentStatus:'Partial',
  items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',
    quantity:2,unitPrice:50,lineTotal:100,unitDescription:'2 PCS'}]};
 for(const width of [390,768,1440]){
  await withCheck('Phase 4J original purchase bill modal reads exact D1 invoice '+width,async()=>{
   const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   const calls=[];await startMocking(ctx,calls);
   await ctx.route('**/api/purchases',route=>route.fulfill({status:200,
    contentType:'application/json',body:JSON.stringify({ok:true,purchases:[invoice]})}));
   await ctx.route('**/api/purchases/PUR-LIVE-SOURCE-001',route=>{
    calls.push({method:route.request().method(),path:'/api/purchases/PUR-LIVE-SOURCE-001'});
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,purchase:invoice})});
   });
   await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
   const page=await ctx.newPage();page.on('pageerror',e=>results.consoleErrors.push('purchase-preview-'+width+': '+e.message));
   await page.goto(base+'/#/app/purchases');
   await page.locator('[data-live-purchases]').waitFor({timeout:12000});
   await page.getByText('PUR-LIVE-SOURCE-001').waitFor({timeout:12000});
   await page.getByRole('button',{name:'View invoice PUR-LIVE-SOURCE-001'}).click();
   const modal=page.getByRole('dialog',{name:/Bill details/i});
   await modal.getByText('Khan Hardware').waitFor({timeout:12000});
   await modal.getByText(/Copper Cable 2.5mm/).waitFor();
   await modal.getByText(/2 PCS/).waitFor();
   assert.match(await modal.innerText(),/100/);
   assert.match(await modal.innerText(),/40/);
   assert.match(await modal.innerText(),/60/);
   assert.equal(calls.filter(c=>c.method==='GET'&&c.path==='/api/purchases/PUR-LIVE-SOURCE-001').length,1);
   assert.ok(!calls.some(c=>['POST','PUT','PATCH','DELETE'].includes(c.method)&&c.path.startsWith('/api/')),
    'Viewing a real invoice must never post money, stock or ledger changes');
   assert.equal(await modal.getByRole('link',{name:/Khan Hardware/}).count(),0,
    'Unconnected demo party route must not be suggested as live ledger');
   if(width===390){await screenshot(page,'phase4j-purchase-source-390');await audit(page,'phase4j-purchase-source-390');}
   await modal.getByRole('button',{name:/Close|বন্ধ করুন/}).click();
   assert.equal(await page.getByRole('dialog',{name:/Bill details/i}).count(),0);
   results.apiCalls.push(...calls);await ctx.close();
  });
 }
 await withCheck('Phase 4J backend detail error never falls back to demo invoice',async()=>{
  const ctx=await browser.newContext({viewport:{width:768,height:900},reducedMotion:'reduce'});
  const calls=[];await startMocking(ctx,calls);
  await ctx.route('**/api/purchases',route=>route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({ok:true,purchases:[invoice]})}));
  await ctx.route('**/api/purchases/PUR-LIVE-SOURCE-001',route=>{
   calls.push({method:route.request().method(),path:'/api/purchases/PUR-LIVE-SOURCE-001'});
   return route.fulfill({status:503,contentType:'application/json',
    body:JSON.stringify({ok:false,error:'Verified purchase invoice temporarily unavailable'})});
  });
  await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
  const page=await ctx.newPage();await page.goto(base+'/#/app/purchases');
  await page.getByRole('button',{name:'View invoice PUR-LIVE-SOURCE-001'}).click();
  await page.getByRole('alert').getByText('Verified purchase invoice temporarily unavailable').waitFor({timeout:12000});
  assert.equal(await page.getByRole('dialog',{name:/Bill details/i}).count(),0);
  assert.equal(calls.length,1);
  await ctx.close();
 });
}
