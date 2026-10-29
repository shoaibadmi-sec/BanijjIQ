import assert from 'node:assert/strict';

/** Synthetic-only, browser-visible acceptance of original source Products route. */
const fixture=(extra={})=>({
  productId:'TASK7-1', productName:'Wire Cable',brand:'National',category:'Electrical',
  unit:'Pcs',barcode:'T7-001',sellingPrice:145,purchasePrice:80,minimumStock:3,
  currentStock:9,sellableStock:9,stockValue:730,trackSerial:0,trackExpiry:0,
  trackWarranty:0,status:'Active',updatedAt:'REV-1',...extra
});
const respond=(route,body,status=200)=>route.fulfill({
  status,contentType:'application/json',body:JSON.stringify(body)
});
const bootstrap=(products)=>({ok:true,products,categories:[
  {id:'CAT-EL',name:'Electrical'},{id:'CAT-HW',name:'Hardware'}
],brands:[{id:'BR-NAT',name:'National'}],units:[{id:'U-PCS',name:'Pcs'}]});
async function session(browser,base,handler,role='admin',width=1024,scheme='light'){
  const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,
    reducedMotion:'reduce'});
  const calls=[];
  await ctx.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    const call={path,method:req.method(),body:req.postData()?req.postDataJSON():null};
    calls.push(call);
    if(path==='/api/auth/me')return respond(route,{ok:true,user:{userId:'T7-USER',
      fullName:'Task 7 Auditor',phone:'01000000777',role}});
    return handler(route,call,calls);
  });
  await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','task7-local-fixture'));
  const page=await ctx.newPage();
  await page.goto(base+'/#/app/products',{waitUntil:'domcontentloaded'});
  await page.locator('[data-live-products]').waitFor({timeout:12000});
  return {ctx,page,calls};
}
async function fillNew(page,barcode='T7-BAR'){
  await page.getByRole('button',{name:/Add product/i}).click();
  await page.locator('[data-mohim-editor]').waitFor();
  await page.locator('input[name="productName"]').fill('New Wire');
  await page.locator('input[name="category"]').fill('Electrical');
  await page.locator('input[name="unit"]').fill('Pcs');
  await page.locator('input[name="purchasePrice"]').fill('25');
  await page.locator('input[name="sellingPrice"]').fill('40');
  await page.locator('input[name="currentStock"]').fill('2');
  await page.locator('input[name="minimumStock"]').fill('1');
  await page.locator('input[name="barcode"]').fill(barcode);
}

export async function runFinalProductChecks({browser,base,withCheck,results}){
  await withCheck('source table: original header, columns, category/search, filters and dark responsive UX',async()=>{
    const goods=[fixture(),fixture({productId:'TASK7-2',productName:'PVC Pipe',
      category:'Hardware',currentStock:2,sellableStock:2,minimumStock:3,stockValue:35,
      barcode:'T7-002'}),fixture({productId:'TASK7-3',productName:'Switch Panel',
      category:'Electrical',currentStock:0,sellableStock:0,stockValue:0,
      barcode:'T7-003'})];
    const {ctx,page,calls}=await session(browser,base,(route,req)=>
      req.path==='/api/bootstrap'?respond(route,bootstrap(goods)):respond(route,{ok:false,error:'Blocked'},404),'admin',1440,'dark');
    try{
      await page.getByText('Wire Cable').first().waitFor();
      assert.ok(await page.getByRole('tablist').count()>0);
      assert.ok(await page.locator('[data-live-products] thead th').count()>=9);
      assert.equal(await page.locator('[data-live-products] tbody tr').count(),3);
      const row=page.locator('tbody tr').filter({hasText:'Wire Cable'});
      const tableText=await row.innerText();
      assert.ok(tableText.includes('730'),'D1 valuation 730 must render; 9*80 is NOT 730');
      assert.ok(!tableText.includes('720'),'Stock value must not be stock*product purchase price');
      assert.ok(await page.locator('tbody tr.text-\\[13px\\]').count()>=3,
        'Original compact row density preserved');
      await page.getByRole('button',{name:/Columns/}).click();
      const purchase=page.getByRole('menuitemcheckbox',{name:/Purchase/});
      await purchase.click();
      assert.equal(await page.locator('thead').getByText('Purchase').count(),0);
      // Restore column using the same persistent source picker.
      await page.getByRole('button',{name:/Columns/}).click();
      await page.getByRole('menuitemcheckbox',{name:/Purchase/}).click();
      await page.getByRole('radio',{name:/^Low/}).click();
      assert.equal(await page.locator('tbody tr').count(),1);
      assert.ok(await page.getByText('PVC Pipe').count()>=1);
      await page.getByRole('radio',{name:/^All stock/}).click();
      await page.getByRole('button',{name:'Hardware'}).click();
      assert.equal(await page.locator('tbody tr').count(),1);
      await page.getByRole('button',{name:'All',exact:true}).click();
      const search=page.getByRole('textbox',{name:/Search products/});
      await search.fill('Switch');
      assert.equal(await page.locator('tbody tr').count(),1);
      await page.getByRole('button',{name:/Clear Search/}).click();
      assert.equal(await page.locator('tbody tr').count(),3);
      assert.ok(calls.every(c=>c.method==='GET'));
      results.apiCalls.push(...calls);
    }finally{await ctx.close();}
  });

  await withCheck('failure path: 503 products bootstrap never falls back to fake data and Retry recovers',async()=>{
    let attempts=0;
    const {ctx,page,calls}=await session(browser,base,(route,req)=>{
      if(req.path!=='/api/bootstrap')return respond(route,{ok:false,error:'Blocked'},404);
      attempts++;
      return attempts===1
        ?respond(route,{ok:false,error:'Temporary inventory outage'},503)
        :respond(route,bootstrap([fixture()]));
    });
    try{
      await page.getByRole('alert').getByText(/Temporary inventory outage/).waitFor({timeout:10000});
      assert.equal(await page.locator('tbody tr').count(),0);
      assert.equal(await page.getByText('Wire Cable').count(),0);
      await page.getByRole('button',{name:'Retry products'}).click();
      await page.getByText('Wire Cable').first().waitFor();
      assert.equal(attempts,2);
      assert.equal(calls.filter(c=>c.method!=='GET').length,0);
    }finally{await ctx.close();}
  });

  await withCheck('duplicate barcode 409 cannot silently post and needs explicit corrected create',async()=>{
    let created=false;
    const {ctx,page,calls}=await session(browser,base,(route,req)=>{
      if(req.path==='/api/bootstrap')return respond(route,bootstrap(created?[fixture({
        productId:'TASK7-NEW',productName:'New Wire',barcode:'T7-NEW',currentStock:2,
        sellableStock:2,stockValue:50})]:[]));
      if(req.path==='/api/products'&&req.method==='POST'){
        if(req.body.barcode==='T7-DUP')return respond(route,{ok:false,error:'Duplicate barcode'},409);
        created=true;return respond(route,{ok:true,productId:'TASK7-NEW'});
      }
      return respond(route,{ok:false,error:'Blocked'},404);
    });
    try{
      await fillNew(page,'T7-DUP');
      await page.getByRole('button',{name:'Save product',exact:true}).click();
      await page.getByRole('alert').getByText(/Duplicate barcode/).waitFor();
      assert.equal(calls.filter(c=>c.method==='POST').length,1);
      assert.equal(await page.getByText('Product saved to BanijjIQ').count(),0);
      await page.locator('input[name="barcode"]').fill('T7-NEW');
      await page.getByRole('button',{name:'Save product',exact:true}).click();
      await page.getByText('New Wire').first().waitFor();
      assert.equal(calls.filter(c=>c.method==='POST').length,2);
    }finally{await ctx.close();}
  });

  await withCheck('409 stale catalog version preserves user form and never retries PUT',async()=>{
    const {ctx,page,calls}=await session(browser,base,(route,req)=>{
      if(req.path==='/api/bootstrap')return respond(route,bootstrap([fixture()]));
      if(req.path==='/api/products/TASK7-1/catalog'&&req.method==='PUT')
        return respond(route,{ok:false,error:'Product modified by another user'},409);
      return respond(route,{ok:false,error:'Blocked'},404);
    });
    try{
      await page.getByText('Wire Cable').first().waitFor();
      await page.getByRole('button',{name:'Actions for Wire Cable'}).click();
      await page.getByRole('menuitem',{name:/^Edit ·/}).click();
      await page.locator('input[name="sellingPrice"]').fill('165');
      await page.getByRole('button',{name:'Save changes'}).click();
      await page.getByRole('alert').getByText(/Another change was saved/).waitFor();
      assert.equal(await page.locator('input[name="sellingPrice"]').inputValue(),'165');
      const puts=calls.filter(c=>c.method==='PUT');
      assert.equal(puts.length,1);
      assert.equal(puts[0].body.expectedUpdatedAt,'REV-1');
      assert.equal('currentStock' in puts[0].body,false);
    }finally{await ctx.close();}
  });

  await withCheck('network-ambiguous create prevents blind duplicate retry and stays unconfirmed',async()=>{
    const {ctx,page,calls}=await session(browser,base,(route,req)=>{
      if(req.path==='/api/bootstrap')return respond(route,bootstrap([]));
      if(req.path==='/api/products'&&req.method==='POST')
        return route.abort('failed');
      return respond(route,{ok:false,error:'Blocked'},404);
    });
    try{
      await fillNew(page);
      await page.getByRole('button',{name:'Save product',exact:true}).click();
      await page.getByRole('alert').getByText(/Save status unknown/).waitFor({timeout:10000});
      assert.equal(await page.getByRole('button',{name:'Save product'}).isDisabled(),true,
        'Unknown create outcome must block a blind second POST');
      assert.equal(calls.filter(c=>c.method==='POST').length,1);
      assert.equal(await page.getByText('Product saved to BanijjIQ').count(),0);
    }finally{await ctx.close();}
  });

  await withCheck('status toggle, real lot/history records, disabled dangerous actions, keyboard Escape',async()=>{
    const data=[fixture()];
    const {ctx,page,calls}=await session(browser,base,(route,req)=>{
      if(req.path==='/api/bootstrap')return respond(route,bootstrap(data));
      if(req.path==='/api/products/TASK7-1/lots')return respond(route,{ok:true,lots:[{
        lotId:'LOT-T7',purchaseId:null,supplierName:null,purchaseDate:'2026-10-29',
        purchasePrice:80,originalQuantity:9,remainingQuantity:9
      }]});
      if(req.path==='/api/products/TASK7-1/history')return respond(route,{ok:true,items:[{
        movementId:'MOV-T7',date:'2026-10-29',type:'STOCK_IN_OPENING',
        quantityIn:9,quantityOut:0,balanceAfter:9,note:'Opening',lotId:'LOT-T7'
      }]});
      if(req.path==='/api/products/TASK7-1/status'&&req.method==='PUT'){
        data[0]={...data[0],status:req.body.status,updatedAt:'REV-2'};
        return respond(route,{ok:true});
      }
      return respond(route,{ok:false,error:'Blocked'},404);
    });
    try{
      await page.getByText('Wire Cable').first().waitFor();
      const menuTrigger=page.getByRole('button',{name:'Actions for Wire Cable'});
      await menuTrigger.focus();await page.keyboard.press('Enter');
      await page.getByRole('menu').waitFor();
      assert.equal(await page.getByRole('menuitem',{name:/Offers/}).isDisabled(),true);
      assert.equal(await page.getByRole('menuitem',{name:/Delete/}).isDisabled(),true);
      await page.getByRole('menuitem',{name:/Stock lots/}).click();
      await page.getByText('LOT-T7').waitFor();
      assert.equal(calls.filter(c=>c.path.endsWith('/lots')).length,1);
      await page.keyboard.press('Escape');
      await menuTrigger.click();
      await page.getByRole('menuitem',{name:/Stock history/}).click();
      await page.getByText('MOV-T7').waitFor();
      assert.equal(calls.filter(c=>c.path.endsWith('/history')).length,1);
      await page.keyboard.press('Escape');
      await menuTrigger.click();
      let confirmation='';
      page.once('dialog',d=>{confirmation=d.message();void d.accept();});
      await page.getByRole('menuitem',{name:/Deactivate/}).click();
      await page.getByText('Product updated · Wire Cable').waitFor();
      assert.match(confirmation,/Inactive Wire Cable/);
      assert.equal(data[0].status,'Inactive');
      assert.equal(calls.filter(c=>c.path.endsWith('/status')&&c.method==='PUT').length,1);
      results.apiCalls.push(...calls);
    }finally{await ctx.close();}
  });
}
