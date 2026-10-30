import assert from 'node:assert/strict';

/** Browser contract for authorized role creation, with synthetic intercepted API only. */
export async function runAdminRoleCreationChecks({browser,base,withCheck}){
  async function open({admin=true,reject=false,failLoad=false,width=390}={}){
    const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const calls=[];
    const roles=[{id:'server-role-1',name:'InventoryStaff',status:'Active',
      permissions:{products:{view:true,add:false,edit:false,delete:'disabled',backdate:'disabled'}}}];
    const options=[{key:'products',label:'Products'},{key:'returns',label:'Sales Return'},
      {key:'users',label:'Users'}];
    const windows=[{key:'disabled',label:'Disabled'},{key:'same',label:'Same Day'},
      {key:'7',label:'7 Days'},{key:'unlimited',label:'Unlimited'}];
    await ctx.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
      // Never persist passwords/credentials; the fixture only records role payloads.
      calls.push({path,method,body:path==='/api/roles'&&method==='POST'?req.postDataJSON():null});
      const reply=(status,value)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(path==='/api/auth/me')return reply(200,{ok:true,user:{
        userId:'role-test-admin',fullName:'Role Test Operator',phone:'01000004810',
        role:admin?'admin':'operator',
        permissions:admin?null:{roles:{view:true,add:true,edit:true},users:{view:true,add:true}}
      }});
      if(path==='/api/users'&&method==='GET')return reply(200,{ok:true,users:[],
        roles:roles.map(x=>({name:x.name,label:x.name})),canAssignAdministrator:admin});
      if(path==='/api/roles'&&method==='GET')return failLoad?
        reply(503,{ok:false,error:'Roles database is unavailable'}):
        reply(200,{ok:true,roles,moduleOptions:options,deleteWindowOptions:windows});
      if(path==='/api/roles'&&method==='POST'){
        if(!admin)return reply(403,{ok:false,error:'Administrator required'});
        if(reject)return reply(400,{ok:false,error:'A role with this name already exists.'});
        const body=req.postDataJSON();
        roles.push({id:'saved-role-2',name:body.name,status:'Active',permissions:body.permissions});
        return reply(200,{ok:true,id:'saved-role-2'});
      }
      return reply(404,{ok:false,error:'Unknown fixture API'});
    });
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','dummy-ci-role-test-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/settings/team');
    await page.locator('[data-live-team-settings]').waitFor({timeout:12000});
    return {page,ctx,calls,roles};
  }
  for(const width of [390,1440])await withCheck('Phase 8A3B2 admin creates custom role with least-privilege permission matrix '+width,async()=>{
    const f=await open({width});
    try{
      await f.page.getByRole('tab',{name:/Roles & permissions/}).click();
      await f.page.getByText('InventoryStaff').first().waitFor({timeout:12000});
      await f.page.getByRole('button',{name:'Add role'}).click();
      const dialog=f.page.getByRole('dialog',{name:'Create role'});
      await dialog.getByRole('textbox',{name:'Role name'}).fill('Warehouse Supervisor');
      await dialog.getByRole('checkbox',{name:'Products — View'}).check();
      await dialog.getByRole('checkbox',{name:'Products — Add'}).check();
      await dialog.getByRole('checkbox',{name:'Products — Edit'}).check();
      await dialog.getByRole('checkbox',{name:'Sales Return — View'}).check();
      await dialog.getByRole('combobox',{name:'Sales Return — Delete window'}).selectOption('same');
      await dialog.getByRole('combobox',{name:'Sales Return — Backdate window'}).selectOption('7');
      await dialog.getByRole('checkbox',{name:'Users — View'}).check();
      await dialog.getByRole('checkbox',{name:'Users — Delete'}).check();
      await dialog.getByRole('button',{name:'Create role'}).click();
      await f.page.locator('[data-live-team-settings]').getByRole('heading',{name:'Warehouse Supervisor'}).waitFor({timeout:12000});
      assert.equal(await dialog.count(),0);
      const writes=f.calls.filter(c=>c.path==='/api/roles'&&c.method==='POST');
      assert.equal(writes.length,1);
      assert.deepEqual(writes[0].body,{
        name:'Warehouse Supervisor',
        permissions:{
          products:{view:true,add:true,edit:true,delete:'disabled',backdate:'disabled'},
          returns:{view:true,add:false,edit:false,delete:'same',backdate:'7'},
          users:{view:true,add:false,edit:false,delete:true,backdate:'disabled'}
        }
      },'explicit delete/backdate defaults; only chosen capabilities submitted');
      assert.ok(f.calls.filter(c=>c.path==='/api/roles'&&c.method==='GET').length>=2,
        'new role must come from confirmed server GET, not synthetic local insertion');
      assert.equal(await f.page.locator('[data-live-team-settings]').getByText('Mahmud Hasan').count(),0);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B2 nonadmin roles.add cannot create roles until delegated security review',async()=>{
    const f=await open({admin:false});
    try{
      await f.page.getByRole('tab',{name:/Roles & permissions/}).click();
      await f.page.getByText('InventoryStaff').first().waitFor({timeout:12000});
      assert.equal(await f.page.getByRole('button',{name:'Add role'}).count(),0);
      assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B2 duplicate role error preserves draft without phantom role',async()=>{
    const f=await open({reject:true});
    try{
      await f.page.getByRole('tab',{name:/Roles & permissions/}).click();
      await f.page.getByText('InventoryStaff').first().waitFor();
      await f.page.getByRole('button',{name:'Add role'}).click();
      const dialog=f.page.getByRole('dialog',{name:'Create role'});
      await dialog.getByRole('textbox',{name:'Role name'}).fill('Duplicate Warehouse Role');
      await dialog.getByRole('checkbox',{name:'Products — View'}).check();
      await dialog.getByRole('button',{name:'Create role'}).click();
      await dialog.getByRole('alert').getByText('A role with this name already exists.').waitFor();
      assert.equal(await dialog.getByRole('textbox',{name:'Role name'}).inputValue(),'Duplicate Warehouse Role');
      assert.equal(await f.page.locator('[data-live-team-settings]').getByText('Duplicate Warehouse Role').count(),0);
      assert.equal(f.roles.length,1);
      assert.equal(f.calls.filter(c=>c.path==='/api/roles'&&c.method==='POST').length,1);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B2 role source failure hides write actions and demo roles',async()=>{
    const f=await open({failLoad:true});
    try{
      await f.page.getByRole('tab',{name:/Roles & permissions/}).click();
      await f.page.getByRole('alert').getByText('Roles database is unavailable').waitFor({timeout:12000});
      assert.equal(await f.page.getByRole('button',{name:'Add role'}).count(),0);
      assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
      assert.equal(await f.page.locator('[data-live-team-settings]').getByRole('heading',{name:'InventoryStaff'}).count(),0,
        'no role card may render after GET /api/roles fails');
    }finally{await f.ctx.close();}
  });
}
