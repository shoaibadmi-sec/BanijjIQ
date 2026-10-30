import assert from 'node:assert/strict';

export async function runPaidRefundChecks({browser,base,withCheck,results,startMocking,screenshot,audit}){
 for(const width of [390,768,1440]){
  await withCheck('4I-C4 verified cash purchase return UI '+width,async()=>{
   const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   const calls=[];await startMocking(ctx,calls);
   let alreadyReturned=0,posts=0,lastPayload;
   const purchase={purchaseId:'PUR-PAID-UI',supplierId:'SUP-UI-001',supplierName:'Khan Hardware',
    purchaseDate:'2026-10-30',status:'Completed',grandTotal:100,paidAmount:100,dueAmount:0,
    discount:0,returnedAmount:0,paymentMethod:'Cash',bankAccountId:'',
    items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',quantity:2,unitPrice:50,lineTotal:100}]};
   await ctx.route('**/api/purchases',route=>route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,purchases:[purchase]})}));
   await ctx.route('**/api/purchases/PUR-PAID-UI',route=>route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,purchase:{...purchase,returnedAmount:alreadyReturned}})}));
   await ctx.route('**/api/purchases/PUR-PAID-UI/return-data',route=>route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,purchase:{...purchase,previouslyReturnedAmount:alreadyReturned,
     netPurchase:100-alreadyReturned,items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',
      boughtQty:2,unitPrice:50,previouslyReturnedQty:alreadyReturned/50,
      availableQty:2-alreadyReturned/50,trackSerial:0,trackExpiry:0}]}})}));
   await ctx.route('**/api/purchases/supplier-settlements/supplier/SUP-UI-001',route=>
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
     ok:true,supplier:{id:'SUP-UI-001',name:'Khan Hardware',currentDue:0},
     ledgerDue:0,needsReconciliation:false,activeSession:true,bankAccounts:[],settlements:[]
    })}));
   await ctx.route('**/api/purchase-returns',route=>{
    if(route.request().method()==='GET')return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ok:true,returns:[]})});
    const payload=route.request().postDataJSON();lastPayload=payload;posts++;
    assert.equal(payload.refundMethod,'Cash');assert.equal(payload.bankAccountId,'');
    assert.equal(payload.purchaseId,'PUR-PAID-UI');assert.equal(payload.reason,'Damaged goods');
    assert.deepEqual(payload.items,[{productId:'PRD-000001',qty:1,unitPrice:50}]);
    assert.match(payload.clientRequestId,/^[0-9a-f-]{32,36}$/i);
    alreadyReturned=50;calls.push({method:'ASSERT',path:'/api/purchase-returns/verified',payload});
    return route.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({ok:true,returnId:'PRTN-PAID-UI',totalReturnAmount:50})});
   });
   await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
   const page=await ctx.newPage();
   page.on('pageerror',e=>results.consoleErrors.push('paid-return-'+width+': '+e.message));
   await page.goto(base+'/#/app/purchases?tab=return&purchaseId=PUR-PAID-UI');
   await page.locator('[data-live-standard-purchase-returns]').waitFor({timeout:12000});
   await page.getByText(/Original paid · পরিশোধ/).waitFor({timeout:12000});
   await page.getByRole('spinbutton',{name:'Return quantity for Copper Cable 2.5mm'}).fill('1');
   await page.getByRole('textbox',{name:'Return reason'}).fill('Damaged goods');
   await page.getByText(/Refund available/).waitFor();
   const submit=page.getByRole('button',{name:/Confirm verified refund/});
   assert.equal(await submit.isDisabled(),false);
   if(width===390){await screenshot(page,'phase4ic4-cash-return-390');await audit(page,'phase4ic4-cash-return-390');}
   await submit.click();await page.getByText(/Refund recorded/).waitFor({timeout:12000});
   assert.equal(posts,1,'One refund money receipt even with rerender');
   assert.equal(lastPayload.items[0].unitPrice,50,'Never edit historical original unit cost');
   results.apiCalls.push(...calls);await ctx.close();
  });
 }
 await withCheck('4I-C4 rejects partially paid and unverified original-bank refunds',async()=>{
   const ctx=await browser.newContext({viewport:{width:768,height:900},reducedMotion:'reduce'});
   const calls=[];await startMocking(ctx,calls);
   let posts=0,partial=true;
   const purchase=()=>({purchaseId:'PUR-BANK-UI',supplierId:'SUP-UI-001',supplierName:'Khan Hardware',
      purchaseDate:'2026-10-30',status:'Completed',grandTotal:100,paidAmount:partial?40:100,
      dueAmount:partial?60:0,discount:0,returnedAmount:0,paymentMethod:'Bank',bankAccountId:'BANK-ORIGINAL',
      items:[{productId:'PRD-000001',productName:'Copper Cable 2.5mm',quantity:2,unitPrice:50}]});
   await ctx.route('**/api/purchases/PUR-BANK-UI',route=>route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,purchase:purchase()})}));
   await ctx.route('**/api/purchases/PUR-BANK-UI/return-data',route=>route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,purchase:{...purchase(),items:[{productId:'PRD-000001',
     productName:'Copper Cable 2.5mm',boughtQty:2,unitPrice:50,previouslyReturnedQty:0,
     availableQty:2,trackSerial:0,trackExpiry:0}]}})}));
   await ctx.route('**/api/purchases/supplier-settlements/supplier/SUP-UI-001',route=>
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,supplier:{id:'SUP-UI-001',name:'Khan Hardware',currentDue:60},
      ledgerDue:60,needsReconciliation:false,activeSession:true,
      bankAccounts:[{id:'BANK-WRONG',name:'Other',type:'Bank',currentBalance:300}],settlements:[]
    })}));
   await ctx.route('**/api/purchase-returns',route=>{posts++;return route.fulfill({
    status:500,contentType:'application/json',body:'{"ok":false,"error":"Must not post"}'})});
   await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
   const page=await ctx.newPage();
   await page.goto(base+'/#/app/purchases?tab=return&purchaseId=PUR-BANK-UI');
   await page.locator('[data-live-standard-purchase-returns]').waitFor({timeout:12000});
   await page.getByRole('spinbutton',{name:'Return quantity for Copper Cable 2.5mm'}).fill('1');
   await page.getByRole('textbox',{name:'Return reason'}).fill('Damaged goods');
   assert.equal(await page.getByRole('button',{name:/Confirm verified refund/}).isDisabled(),true,
     'Partial-paid refunds require explicit allocation, cannot trigger money receipt');
   assert.equal(posts,0);
   await ctx.close();
 });
}
