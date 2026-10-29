import assert from 'node:assert/strict';

/**
 * Browser contract for the temporary D1 Products route.
 * This is never connected to a deployed Worker: every API call is intercepted.
 */
export async function runProductsHybridChecks({browser,base,withCheck,results}) {
  await withCheck('Mohim Product editor posts exactly once and uses confirmed server catalog',async()=>{
    const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
    const calls=[];
    const products=[{
      productId:'PRD-UI-1',productName:'Copper Cable',brand:'Demo Brand',
      category:'Electrical',unit:'Pcs',barcode:'UI-OLD-1',purchasePrice:20,
      sellingPrice:30,currentStock:5,sellableStock:5,stockValue:100,minimumStock:1,
      trackSerial:0,trackExpiry:0,trackWarranty:0,status:'Active',updatedAt:'REV-UI-1'
    }];
    let unitRevision=0,unitProfile=null;
    const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    try {
      await context.route('**/api/**',async route=>{
        const req=route.request(),url=new URL(req.url()),path=url.pathname;
        calls.push({method:req.method(),path,body:req.postDataJSON?.()});
        if(path==='/api/auth/me')return json(route,{ok:true,user:{userId:'ADMIN',fullName:'Test Admin',
          role:'admin',phone:'01000000000'}});
        if(path==='/api/bootstrap')return json(route,{
          ok:true,products,categories:[{id:'CAT-1',name:'Electrical'}],
          brands:[{id:'BRD-1',name:'Demo Brand'}],
          units:[{id:'UNT-1',name:'Pcs'}]
        });
        if(path==='/api/products'&&req.method()==='POST'){
          const data=req.postDataJSON();
          assert.equal(data.productName,'New Product');
          assert.equal(data.currentStock,3);
          assert.equal(data.category,'Electrical');
          await new Promise(resolve=>setTimeout(resolve,350)); // observe a genuinely pending save
          products.unshift({...products[0],...data,productId:'PRD-UI-2',
            trackSerial:0,trackExpiry:0,trackWarranty:0,stockValue:60,
            sellableStock:3,updatedAt:'REV-UI-2'});
          return json(route,{ok:true,productId:'PRD-UI-2'});
        }
        if(path==='/api/products/PRD-UI-1/unit-profile'){
          if(req.method()==='GET')return json(route,{ok:true,productId:'PRD-UI-1',
            revision:unitRevision,profile:unitProfile,postingEnabled:true});
          if(req.method()==='PUT'){
            const b=req.postDataJSON();
            assert.equal(b.expectedRevision,unitRevision);
            assert.equal(b.units.length,3);
            assert.deepEqual(b.units.map(x=>x.unit),['Carton','Box','Pcs']);
            assert.deepEqual(b.units.slice(0,2).map(x=>x.containsNext),[12,20]);
            assert.deepEqual(b.units.map(x=>x.symbol),['CT','BOX','PCS']);
            unitRevision++;
            const factors=[240,20,1];
            unitProfile={baseUnit:'Pcs',units:b.units.map((x,i)=>({
              unit:x.unit,symbol:x.symbol,containsNext:i===2?null:x.containsNext,
              factor:factors[i],sellingPrice:x.sellingPrice??30*factors[i]
            }))};
            return json(route,{ok:true,revision:unitRevision,productId:'PRD-UI-1',
              profile:unitProfile,postingEnabled:true});
          }
        }
        if(path==='/api/products/PRD-UI-1/adjust-stock'&&req.method()==='POST'){
          const {delta,note}=req.postDataJSON();
          assert.deepEqual({delta,note},{delta:-1,note:'Damaged item'});
          const old=products.find(p=>p.productId==='PRD-UI-1');
          old.currentStock+=delta;old.sellableStock+=delta;
          return json(route,{ok:true});
        }
        if(path==='/api/products/PRD-UI-1/lots')return json(route,{ok:true,lots:[
          {lotId:'LOT-A',purchaseId:'OPENING',supplierName:null,purchaseDate:'2026-10-29',
           purchasePrice:20,originalQuantity:5,remainingQuantity:5}
        ]});
        if(path==='/api/products/PRD-UI-1/history')return json(route,{ok:true,items:[
          {movementId:'MOV-A',date:'2026-10-29',type:'STOCK_IN_ADJUSTMENT',
           quantityIn:5,quantityOut:0,balanceAfter:5,note:'Opening',lotId:'LOT-A'}
        ]});
        return json(route,{ok:false,error:'Unmocked API request'},404);
      });
      await context.addInitScript(()=>localStorage.setItem('shererp_auth_token','synthetic-browser-only'));
      const page=await context.newPage();
      await page.goto(base+'/#/app/products');
      await page.getByRole('button',{name:/Add product/i}).click();
      await page.locator('[data-mohim-editor]').waitFor();
      const sequence=await page.locator('[data-mohim-editor] input[name]').evaluateAll(nodes=>nodes.map(n=>n.name));
      assert.deepEqual(sequence,['productName','brand','category','unit','purchasePrice',
        'sellingPrice','currentStock','minimumStock','barcode']);
      assert.equal(await page.locator('#product-lookup-category option[value="Electrical"]').count(),1);
      await page.getByRole('textbox',{name:'Product name'}).fill('New Product');
      await page.locator('[data-mohim-editor] input[name="category"]').fill('Electrical');
      await page.locator('[data-mohim-editor] input[name="unit"]').fill('Pcs');
      await page.getByRole('spinbutton',{name:'Purchase price'}).fill('20');
      await page.getByRole('spinbutton',{name:'Selling price'}).fill('50');
      await page.getByRole('spinbutton',{name:'Opening stock'}).fill('3');
      await page.getByRole('spinbutton',{name:'Minimum stock'}).fill('1');
      const save=page.getByRole('button',{name:'Save product'});
      await save.click();
      await page.getByRole('button',{name:'Save product',disabled:true}).waitFor({timeout:3000});
      await page.getByText('Product saved to BanijjIQ').waitFor({timeout:10000});
      assert.equal(calls.filter(x=>x.method==='POST'&&x.path==='/api/products').length,1);
      await page.getByText('New Product').first().waitFor();
      await page.getByRole('button',{name:'Actions for Copper Cable'}).click();
      await page.getByRole('menuitem',{name:/Edit ·/}).click();
      await page.locator('[data-live-unit-settings] button[aria-expanded]').click();
      await page.getByRole('combobox',{name:'Unit 1'}).fill('Box');
      await page.getByRole('textbox',{name:'Short symbol 1'}).fill('BOX');
      await page.getByRole('spinbutton',{name:'Contains next 1'}).fill('20');
      await page.getByRole('spinbutton',{name:'Selling price for Box'}).fill('580');
      await page.getByRole('button',{name:/Add larger unit/}).click();
      await page.getByRole('combobox',{name:'Unit 1'}).fill('Carton');
      await page.getByRole('textbox',{name:'Short symbol 1'}).fill('CT');
      await page.getByRole('spinbutton',{name:'Contains next 1'}).fill('12');
      await page.getByRole('spinbutton',{name:'Selling price for Carton'}).fill('6900');
      await page.getByRole('button',{name:/Save units/}).click();
      await page.getByText('Unit chain saved').waitFor({timeout:6000});
      assert.equal(unitRevision,1);
      assert.equal(calls.filter(x=>x.method==='PUT'&&x.path.endsWith('/unit-profile')).length,1);
      await page.getByRole('button',{name:/Back to products/}).click();
      await page.getByRole('button',{name:'Actions for Copper Cable'}).click();
      await page.getByRole('menuitem',{name:/Stock history/}).click();
      await page.getByText('MOV-A').waitFor();
      assert.equal(calls.filter(x=>x.path==='/api/products/PRD-UI-1/history').length,1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[role="dialog"]').count(),0);
      await page.getByRole('button',{name:'Actions for Copper Cable'}).click();
      await page.getByRole('menuitem',{name:/Adjust stock/}).click();
      await page.getByRole('spinbutton',{name:'Stock change'}).fill('-1');
      assert.equal(await page.getByRole('spinbutton',{name:'Stock change'}).evaluate(el=>el.checkValidity()),true,
        'The shared NumericInput defaults to min=0; signed adjustment must override this.');
      await page.getByRole('textbox',{name:'Adjustment reason'}).fill('Damaged item');
      let confirmation='';
      page.once('dialog',d=>{confirmation=d.message();void d.accept();});
      await page.getByRole('button',{name:'Review and save adjustment'}).click();
      assert.match(confirmation,/5.*4/,'confirmation must show old and new quantity');
      assert.ok(confirmation.includes('Damaged item'),'confirmation must show entered reason');
      await page.waitForTimeout(400);
      const adjustments=calls.filter(x=>x.path==='/api/products/PRD-UI-1/adjust-stock'&&x.method==='POST');
      const errors=await page.locator('[role="alert"]').allTextContents();
      assert.equal(adjustments.length,1,'Expected one stock POST; UI errors: '+errors.join(' | '));
      await page.getByText('Product updated · Copper Cable').waitFor({timeout:3000});
      results.apiCalls.push(...calls);
    } finally {await context.close();}
  });
  await withCheck('read-only role sees actions but cannot submit product writes',async()=>{
    const context=await browser.newContext({viewport:{width:768,height:900},reducedMotion:'reduce'});
    const calls=[];
    try {
      await context.route('**/api/**',route=>{
        const req=route.request(),path=new URL(req.url()).pathname;
        calls.push(req.method()+' '+path);
        const body=path==='/api/auth/me'
          ?{ok:true,user:{userId:'READER',fullName:'Read Only',phone:'01000000001',role:'staff',
            permissions:{products:{view:true,add:false,edit:false}}}}
          :path==='/api/bootstrap'?{ok:true,products:[{
            productId:'READ-1',productName:'Readonly Cable',brand:'',category:'Electrical',
            unit:'Pcs',barcode:'',purchasePrice:10,sellingPrice:20,currentStock:3,
            sellableStock:3,stockValue:30,minimumStock:1,trackSerial:0,trackExpiry:0,
            trackWarranty:0,status:'Active',updatedAt:'REV-1'
          }],categories:[],brands:[],units:[]}:{ok:false,error:'Blocked mock'};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      });
      await context.addInitScript(()=>localStorage.setItem('shererp_auth_token','synthetic-reader'));
      const page=await context.newPage();
      await page.goto(base+'/#/app/products');
      await page.getByText('Readonly Cable').waitFor();
      assert.equal(await page.getByRole('button',{name:/Add product/i}).isDisabled(),true,
        'Original HisabIQ Add product remains visible but disabled for read-only users');
      await page.getByRole('button',{name:'Actions for Readonly Cable'}).click();
      assert.equal(await page.getByRole('menuitem',{name:/^Edit ·/}).isDisabled(),true);
      assert.equal(await page.getByRole('menuitem',{name:/Adjust stock/}).isDisabled(),true);
      assert.equal(await page.getByRole('menuitem',{name:/Deactivate/}).isDisabled(),true);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('menu').count(),0);
      assert.equal(calls.some(s=>/POST|PUT|DELETE/.test(s)),false);
    } finally {await context.close();}
  });
  await withCheck('original Products table has an authentic empty-D1 state, not sample products',async()=>{
    const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
    const calls=[];
    try{
      await context.route('**/api/**',route=>{
        const req=route.request(),path=new URL(req.url()).pathname;
        calls.push(req.method()+' '+path);
        const body=path==='/api/auth/me'
          ?{ok:true,user:{userId:'EMPTY-ADMIN',fullName:'Empty Shop',phone:'01000009999',role:'admin'}}
          :path==='/api/bootstrap'
           ?{ok:true,products:[],categories:[],brands:[],units:[]}
           :{ok:false,error:'Unexpected request'};
        return route.fulfill({status:path==='/api/bootstrap'||path==='/api/auth/me'?200:404,
          contentType:'application/json',body:JSON.stringify(body)});
      });
      await context.addInitScript(()=>localStorage.setItem('shererp_auth_token','empty-shop-test-token'));
      const page=await context.newPage();
      await page.goto(base+'/#/app/products');
      await page.locator('[data-live-products]').waitFor();
      await page.getByText('No products match').waitFor();
      assert.equal(await page.locator('[data-live-products] tbody tr').count(),0);
      assert.equal(await page.getByText('Copper Cable 2.5mm').count(),0);
      assert.equal(await page.getByText('PVC Pipe 20mm').count(),0);
      assert.equal(calls.filter(v=>v==='GET /api/bootstrap').length,1);
      assert.equal(calls.filter(v=>/POST|PUT|DELETE/.test(v)).length,0);
    }finally{await context.close();}
  });

}
