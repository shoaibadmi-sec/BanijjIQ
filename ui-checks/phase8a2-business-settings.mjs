import assert from 'node:assert/strict';

// Browser-level checks against the *generated* original React Settings shell.
// Every response is synthetic and intercepted; never contact a deployed Worker.
export async function runLiveBusinessSettingsChecks({browser,base,withCheck}){
  const settings={
    'Shop Name':'D1 Source Hardware',
    'Shop Name Bangla':'ডি ওয়ান হার্ডওয়্যার',
    'Phone 1':'01700002611',
    'Email':'source-test@example.invalid',
    'Address':'Source Street, Dhaka',
    'Session Timeout Hours':'12'
  };
  async function open(role='admin',failLoad=false,width=390){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const calls=[];
    await context.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
      calls.push({path,method,body:method==='PUT'?req.postDataJSON():null});
      const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(path==='/api/auth/me')return reply({ok:true,user:{
        userId:'UI-SETTINGS-STAFF',fullName:'Test Settings User',phone:'01700002620',
        role,permissions:role==='admin'?null:{settings:{view:true,add:false,edit:false}}
      }});
      if(path==='/api/settings/bootstrap'&&method==='GET')
        return failLoad?reply({ok:false,error:'D1 settings source unavailable'},503):
          reply({ok:true,settings,bankAccounts:[]});
      if(path==='/api/settings'&&method==='PUT')
        return reply({ok:true});
      return reply({ok:false,error:'Fixture endpoint unavailable'},404);
    });
    await context.addInitScript(()=>localStorage.setItem('shererp_auth_token','settings-ui-test-token'));
    const page=await context.newPage();
    await page.goto(base+'/#/app/settings/business');
    return {page,context,calls};
  }

  for(const width of [390,1440]){
    await withCheck('Phase 8A2 live business settings read/write '+width,async()=>{
      const f=await open('admin',false,width);
      try{
        const panel=f.page.locator('[data-live-business-settings]');
        await panel.waitFor({timeout:12000});
        const name=f.page.getByRole('textbox',{name:'Business name',exact:true});
        await name.waitFor({timeout:12000});
        assert.equal(await name.inputValue(),'D1 Source Hardware','must load D1 value, not demo/localStorage');
        assert.equal(await f.page.getByRole('textbox',{name:'Phone number'}).inputValue(),'01700002611');
        assert.equal(await f.page.getByRole('textbox',{name:'Business email'}).inputValue(),'source-test@example.invalid');
        assert.equal(await f.page.getByRole('textbox',{name:'Business address'}).inputValue(),'Source Street, Dhaka');
        assert.equal(await panel.getByText('Nawabpur Hardware House').count(),0,'must never show the demo business as live');
        await name.fill('Updated Source Hardware');
        await f.page.getByRole('button',{name:'Save business settings'}).click();
        await panel.getByText('Business settings saved.').waitFor({timeout:10000});
        const writes=f.calls.filter(x=>x.method==='PUT'&&x.path==='/api/settings');
        assert.equal(writes.length,1,'one intentional save action');
        assert.deepEqual(writes[0].body,{'Shop Name':'Updated Source Hardware'},
          'only changed supported field; never submit unrelated sensitive settings');
        assert.ok(f.calls.some(x=>x.path==='/api/settings/bootstrap'&&x.method==='GET'));
      }finally{await f.context.close();}
    });
  }
  await withCheck('Phase 8A2 read-only settings role cannot submit changes',async()=>{
    const f=await open('cashier');
    try{
      const panel=f.page.locator('[data-live-business-settings]');
      await panel.waitFor({timeout:12000});
      const name=f.page.getByRole('textbox',{name:'Business name',exact:true});
      await name.waitFor({timeout:12000});
      assert.equal(await name.inputValue(),'D1 Source Hardware');
      assert.equal(await name.isDisabled(),true);
      const save=f.page.getByRole('button',{name:'Save business settings'});
      assert.ok(await save.isDisabled()||await save.count()===0);
      assert.equal(f.calls.filter(x=>x.method==='PUT').length,0);
    }finally{await f.context.close();}
  });
  await withCheck('Phase 8A2 settings source error fails closed without fake fallback',async()=>{
    const f=await open('admin',true);
    try{
      const panel=f.page.locator('[data-live-business-settings]');
      await panel.waitFor({timeout:12000});
      await panel.getByRole('alert').getByText('D1 settings source unavailable').waitFor({timeout:10000});
      assert.equal(await f.page.getByRole('textbox',{name:'Business name',exact:true}).count(),0);
      assert.equal(await panel.getByText('Nawabpur Hardware House').count(),0);
      assert.equal(f.calls.filter(x=>x.method==='PUT').length,0);
    }finally{await f.context.close();}
  });
}
