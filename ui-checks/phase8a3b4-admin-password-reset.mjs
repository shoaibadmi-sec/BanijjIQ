import assert from 'node:assert/strict';

/** Phase 8A3B4: password reset UI needs server authorization, never a demo-only mutation. */
export async function runAdminPasswordResetChecks({browser,base,withCheck}){
  async function open({admin=true,reject=false,usersFail=false,width=390}={}){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const calls=[];
    const employees=[
      {id:'staff-1',name:'Existing Real Employee',mobile:'01000008601',role:'InventoryStaff',
        roleLabel:'InventoryStaff',status:'Active',createdAt:'2026-10-30'},
      {id:'admin-1',name:'Business Administrator',mobile:'01000008600',role:'admin',
        roleLabel:'Administrator',status:'Active',createdAt:'2026-10-30'}
    ];
    await context.route('**/api/**',async route=>{
      const req=route.request(),method=req.method(),path=new URL(req.url()).pathname;
      calls.push({method,path,body:method==='POST'?req.postDataJSON():null});
      const reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(path==='/api/auth/me')return reply(200,{ok:true,user:{
        userId:admin?'admin-1':'staff-manager',fullName:'Authenticated Operator',
        phone:'01000008600',role:admin?'admin':'manager',
        permissions:admin?null:{users:{view:true,edit:true},roles:{view:true}}
      }});
      if(path==='/api/users'&&method==='GET')return usersFail?
        reply(503,{ok:false,error:'Employee directory unavailable'}):
        reply(200,{ok:true,users:employees,roles:[{name:'InventoryStaff',label:'InventoryStaff'}],
          canAssignAdministrator:admin});
      if(path==='/api/roles'&&method==='GET')return reply(200,{ok:true,roles:[],
        moduleOptions:[{key:'products',label:'Products'}],deleteWindowOptions:[]});
      if(path==='/api/users/staff-1/reset-password'&&method==='POST'){
        if(!admin)return reply(403,{ok:false,error:'Administrator required'});
        if(reject)return reply(400,{ok:false,error:'Password reset was rejected by the server.'});
        return reply(200,{ok:true,id:'staff-1'});
      }
      return reply(404,{ok:false,error:'Unknown fixture endpoint'});
    });
    await context.addInitScript(()=>localStorage.setItem('shererp_auth_token','ci-password-reset-token'));
    const page=await context.newPage();
    await page.goto(base+'/#/app/settings/team');
    await page.locator('[data-live-team-settings]').waitFor({timeout:12000});
    return {page,context,calls,employees};
  }
  async function openReset(page){
    await page.locator('[data-live-team-settings]').getByText('Existing Real Employee').waitFor();
    await page.getByRole('button',{name:'Actions for Existing Real Employee'}).click();
    await page.getByRole('menuitem',{name:'Reset password'}).click();
    return page.getByRole('dialog',{name:'Reset employee password'});
  }
  for(const width of [390,1440]){
    await withCheck('Phase 8A3B4 administrator resets password once through existing employee Actions '+width,async()=>{
      const f=await open({width});
      try{
        const dialog=await openReset(f.page);
        await dialog.getByLabel('New password').fill('Only-For-Local-Test-2026!');
        await dialog.getByLabel('Confirm password').fill('Only-For-Local-Test-2026!');
        assert.equal(f.calls.filter(c=>c.method==='POST').length,0,'no write on opening password dialog');
        await dialog.getByRole('button',{name:'Reset password'}).click();
        await f.page.getByRole('status').getByText('Password reset. Existing sessions were revoked.').waitFor({timeout:12000});
        assert.equal(await dialog.count(),0);
        assert.deepEqual(f.calls.filter(c=>c.method==='POST'),[{
          method:'POST',path:'/api/users/staff-1/reset-password',
          body:{newPassword:'Only-For-Local-Test-2026!'}
        }]);
        assert.equal(f.employees[0].name,'Existing Real Employee');
        assert.equal(await f.page.locator('[data-live-team-settings]').getByText('Only-For-Local-Test-2026!').count(),0,
          'new password must not be shown in employee table or alert');
      }finally{await f.context.close();}
    });
  }
  await withCheck('Phase 8A3B4 mismatched password confirmation blocks the API request',async()=>{
    const f=await open();
    try{
      const dialog=await openReset(f.page);
      await dialog.getByLabel('New password').fill('New-Password-2026!');
      await dialog.getByLabel('Confirm password').fill('Different-Password-2026!');
      await dialog.getByRole('button',{name:'Reset password'}).click();
      await dialog.getByRole('alert').getByText('Passwords do not match.').waitFor({timeout:12000});
      assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
      assert.equal(await dialog.count(),1);
    }finally{await f.context.close();}
  });
  await withCheck('Phase 8A3B4 server rejection keeps reset confirmation and never announces success',async()=>{
    const f=await open({reject:true});
    try{
      const dialog=await openReset(f.page);
      await dialog.getByLabel('New password').fill('New-Password-2026!');
      await dialog.getByLabel('Confirm password').fill('New-Password-2026!');
      await dialog.getByRole('button',{name:'Reset password'}).click();
      await dialog.getByRole('alert').getByText('Password reset was rejected by the server.').waitFor();
      assert.equal(await dialog.count(),1);
      assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
      assert.equal(await f.page.getByText('Password reset. Existing sessions were revoked.').count(),0);
    }finally{await f.context.close();}
  });
  await withCheck('Phase 8A3B4 delegated users.edit cannot reset passwords in browser',async()=>{
    const f=await open({admin:false});
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      assert.equal(await f.page.getByRole('button',{name:'Actions for Existing Real Employee'}).count(),0);
      assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
    }finally{await f.context.close();}
  });
  await withCheck('Phase 8A3B4 administrator password is not resettable through Team employee actions',async()=>{
    const f=await open();
    try{
      await f.page.getByText('Business Administrator').waitFor();
      assert.equal(await f.page.getByRole('button',{name:'Actions for Business Administrator'}).count(),0);
      assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
    }finally{await f.context.close();}
  });
  await withCheck('Phase 8A3B4 unavailable employees API does not expose password reset actions',async()=>{
    const f=await open({usersFail:true});
    try{
      await f.page.getByRole('alert').getByText('Employee directory unavailable').waitFor({timeout:12000});
      assert.equal(await f.page.getByRole('menuitem',{name:'Reset password'}).count(),0);
      assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
    }finally{await f.context.close();}
  });
}
