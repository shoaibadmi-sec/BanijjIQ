import assert from 'node:assert/strict';

/** Phase 8A3 browser contract, isolated synthetic API only.
 * The original HisabIQ Settings design stays unchanged; live data must come from
 * authenticated server endpoints, never the localStorage demo team. */
export async function runLiveTeamChecks({browser,base,withCheck}){
  async function open({userView=true,roleView=true,roleFailure=false,width=390}={}){
    const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const calls=[];
    await ctx.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname;
      calls.push({path,method:req.method()});
      const reply=(status,value)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(path==='/api/auth/me')return reply(200,{ok:true,user:{
        userId:'AUTH-OWNER-8A3',fullName:'Logged In Operator',phone:'01000000801',
        role:'staff',permissions:{users:{view:userView},roles:{view:roleView}}
      }});
      if(path==='/api/users'&&req.method()==='GET')return reply(200,{ok:true,
        users:[{id:'usr-8a3-1',name:'Live Warehouse Keeper',mobile:'01000000802',
          role:'InventoryStaff',roleLabel:'InventoryStaff',status:'Active',createdAt:'2026-10-30'}],
        roles:[{name:'InventoryStaff',label:'InventoryStaff'}],canAssignAdministrator:false
      });
      if(path==='/api/roles'&&req.method()==='GET')return roleFailure
        ?reply(503,{ok:false,error:'Live roles temporarily unavailable'})
        :reply(200,{ok:true,roles:[{id:'r-8a3-1',name:'InventoryStaff',status:'Active',
          permissions:{products:{view:true,add:false,edit:false},users:{view:true,add:false,edit:false}},
          allowedModules:['products','users'],createdAt:'2026-10-30'}],
          moduleOptions:['products','users'],deleteWindowOptions:[]});
      return reply(404,{ok:false,error:'Unknown mock API'});
    });
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-phase8a3-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/settings/team');
    return {page,ctx,calls};
  }

  for(const width of [390,1440])await withCheck('Phase 8A3 authenticated live users and roles '+width,async()=>{
    const f=await open({width});
    try{
      const panel=f.page.locator('[data-live-team-settings]');
      await panel.waitFor({timeout:12000});
      await panel.getByText('Live Warehouse Keeper').waitFor({timeout:12000});
      await panel.getByText('01000000802').waitFor();
      assert.equal(await panel.getByText('Mahmud Hasan').count(),0,'never display UI demo users as live');
      assert.equal(await panel.getByText('Rafiq Islam').count(),0);
      await f.page.getByRole('tab',{name:/Roles & permissions/}).click();
      await panel.getByText('InventoryStaff').first().waitFor();
      await panel.getByText('products.view').waitFor();
      assert.ok(f.calls.some(c=>c.method==='GET'&&c.path==='/api/users'));
      assert.ok(f.calls.some(c=>c.method==='GET'&&c.path==='/api/roles'));
      assert.ok(f.calls.every(c=>c.method==='GET'),'read-only view must never write');
      assert.equal(await panel.getByRole('button',{name:/Create role|Add employee|Delete role|Reset password/}).count(),0,
        'blocked mutation controls cannot be displayed as operative actions');
    }finally{await f.ctx.close();}
  });

  await withCheck('Phase 8A3 user viewer has no roles endpoint access or forged role list',async()=>{
    const f=await open({userView:true,roleView:false});
    try{
      const panel=f.page.locator('[data-live-team-settings]');
      await panel.getByText('Live Warehouse Keeper').waitFor({timeout:12000});
      assert.equal(f.calls.filter(c=>c.path==='/api/roles').length,0);
      assert.equal(await f.page.getByRole('tab',{name:/Roles & permissions/}).count(),0);
    }finally{await f.ctx.close();}
  });

  await withCheck('Phase 8A3 role viewer cannot fetch users or show demo employees',async()=>{
    const f=await open({userView:false,roleView:true});
    try{
      const panel=f.page.locator('[data-live-team-settings]');
      await panel.waitFor({timeout:12000});
      await f.page.getByRole('tab',{name:/Roles & permissions/}).waitFor();
      await panel.getByText('InventoryStaff').first().waitFor({timeout:12000});
      assert.equal(f.calls.filter(c=>c.path==='/api/users').length,0);
      assert.equal(await panel.getByText('Live Warehouse Keeper').count(),0);
      assert.equal(await f.page.getByRole('tab',{name:/Employees/}).count(),0);
    }finally{await f.ctx.close();}
  });

  await withCheck('Phase 8A3 server roles failure remains unavailable, not demo data',async()=>{
    const f=await open({userView:false,roleView:true,roleFailure:true});
    try{
      const panel=f.page.locator('[data-live-team-settings]');
      await panel.getByRole('alert').getByText('Live roles temporarily unavailable').waitFor({timeout:12000});
      assert.equal(await panel.getByText('InventoryStaff').count(),0);
      assert.equal(await panel.getByText('Business owner').count(),0);
      assert.ok(f.calls.every(c=>c.method==='GET'));
    }finally{await f.ctx.close();}
  });
}
