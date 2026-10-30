import assert from 'node:assert/strict';

export async function runAdminEmployeeCreateChecks({browser,base,withCheck}){
  async function open({admin=true,reject=false,width=390}={}){
    const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const calls=[];
    const employees=[{id:'user-1',name:'Existing Real Employee',mobile:'01000000901',
      role:'InventoryStaff',roleLabel:'InventoryStaff',status:'Active',createdAt:'2026-10-30'}];
    await ctx.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
      calls.push({path,method,body:method==='POST'?req.postDataJSON():null});
      const reply=(status,value)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(path==='/api/auth/me')return reply(200,{ok:true,user:{
        userId:'CURRENT-ACTOR',fullName:'Logged In Operator',phone:'01000000900',
        role:admin?'admin':'staff',
        permissions:admin?null:{users:{view:true,add:true,edit:true},roles:{view:true}}
      }});
      if(path==='/api/users'&&method==='GET')return reply(200,{ok:true,users:employees,
        roles:[{name:'InventoryStaff',label:'InventoryStaff'}],canAssignAdministrator:admin});
      if(path==='/api/roles'&&method==='GET')return reply(200,{ok:true,roles:[{
        id:'role-1',name:'InventoryStaff',status:'Active',
        permissions:{products:{view:true}},allowedModules:['products']
      }],moduleOptions:['products'],deleteWindowOptions:[]});
      if(path==='/api/users'&&method==='POST'){
        if(!admin)return reply(403,{ok:false,error:'Administrator required'});
        if(reject)return reply(400,{ok:false,error:'A user with this mobile number already exists.'});
        const input=req.postDataJSON();
        employees.push({id:'created-user',name:input.name,mobile:input.mobile,role:input.role,
          roleLabel:input.role,status:'Active',createdAt:'2026-10-30'});
        return reply(200,{ok:true,id:'created-user'});
      }
      return reply(404,{ok:false,error:'Unknown endpoint'});
    });
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','8a3b1-dummy-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/settings/team');
    await page.locator('[data-live-team-settings]').waitFor({timeout:12000});
    return {page,ctx,calls,employees};
  }
  for(const width of [390,1440]){
    await withCheck('Phase 8A3B1 administrator creates exactly one D1 employee via current Team layout '+width,async()=>{
      const f=await open({width});
      try{
        await f.page.getByText('Existing Real Employee').waitFor();
        await f.page.getByRole('button',{name:'Add employee'}).click();
        const editor=f.page.getByRole('dialog',{name:'Add employee'});
        await editor.getByRole('textbox',{name:'Employee name'}).fill('New Verified Employee');
        await editor.getByRole('textbox',{name:'Mobile number'}).fill('01000000902');
        await editor.getByRole('combobox',{name:'Employee role'}).selectOption('InventoryStaff');
        await editor.getByLabel('Initial password').fill('Test-Secret-Only-2026!');
        await editor.getByRole('button',{name:'Create employee'}).click();
        await f.page.getByText('New Verified Employee').waitFor({timeout:12000});
        assert.equal(await editor.count(),0);
        const posts=f.calls.filter(x=>x.path==='/api/users'&&x.method==='POST');
        assert.equal(posts.length,1,'exactly one POST on confirmation');
        assert.deepEqual(posts[0].body,{
          name:'New Verified Employee',mobile:'01000000902',role:'InventoryStaff',
          password:'Test-Secret-Only-2026!'
        });
        assert.ok(f.calls.filter(x=>x.path==='/api/users'&&x.method==='GET').length>=2,
          'confirmed employee must be refreshed from server');
        assert.equal(await f.page.getByText('Mahmud Hasan').count(),0,'demo identities prohibited');
      }finally{await f.ctx.close();}
    });
  }
  await withCheck('Phase 8A3B1 delegated role with users.add still cannot use account creation',async()=>{
    const f=await open({admin:false});
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      assert.equal(await f.page.getByRole('button',{name:'Add employee'}).count(),0);
      assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B1 duplicate account error does not create a fake employee',async()=>{
    const f=await open({reject:true});
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      await f.page.getByRole('button',{name:'Add employee'}).click();
      const editor=f.page.getByRole('dialog',{name:'Add employee'});
      await editor.getByRole('textbox',{name:'Employee name'}).fill('Duplicate Account');
      await editor.getByRole('textbox',{name:'Mobile number'}).fill('01000000901');
      await editor.getByRole('combobox',{name:'Employee role'}).selectOption('InventoryStaff');
      await editor.getByLabel('Initial password').fill('Some-Password-2026!');
      await editor.getByRole('button',{name:'Create employee'}).click();
      await editor.getByRole('alert').getByText('A user with this mobile number already exists.').waitFor();
      assert.equal(f.employees.length,1);
      assert.equal(await f.page.getByText('Duplicate Account').count(),0);
      assert.equal(f.calls.filter(x=>x.path==='/api/users'&&x.method==='POST').length,1);
    }finally{await f.ctx.close();}
  });
}
