import assert from 'node:assert/strict';

/** Phase 8 source-of-truth: original TeamSettings and EmployeeDirectory, real API only. */
export async function runPhase8TeamSourceParityChecks({browser,base,withCheck}){
  async function open({admin=true,failUsers=false,failRoles=false,width=390}={}){
    const ctx=await browser.newContext({viewport:{width,height:940},reducedMotion:'reduce'});
    const calls=[];
    await ctx.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
      calls.push({path,method});
      const reply=(status,value)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
      if(path==='/api/auth/me')return reply(200,{ok:true,user:{
        userId:'real-owner',fullName:'Authenticated Owner',phone:'01000008900',
        role:admin?'admin':'staff',
        permissions:admin?null:{users:{view:true},roles:{view:true}}
      }});
      if(path==='/api/users'&&method==='GET')return failUsers
        ?reply(503,{ok:false,error:'Employees database unavailable'})
        :reply(200,{ok:true,users:[
          {id:'real-owner',name:'Authenticated Owner',mobile:'01000008900',role:'admin',status:'Active',createdAt:'2026-10-30'},
          {id:'warehouse-1',name:'Verified Warehouse Keeper',mobile:'01000008901',
            role:'StockViewer',status:'Active',createdAt:'2026-10-30'},
          {id:'warehouse-2',name:'Verified Office Operator',mobile:'01000008902',
            role:'StockViewer',status:'Inactive',createdAt:'2026-10-30'}
        ],roles:[{name:'StockViewer',label:'StockViewer'}]});
      if(path==='/api/roles'&&method==='GET')return failRoles
        ?reply(503,{ok:false,error:'Roles database unavailable'})
        :reply(200,{ok:true,roles:[{id:'stockviewer-id',name:'StockViewer',status:'Active',
          permissions:{products:{view:true,add:false,edit:false,delete:'disabled'}}}]});
      return reply(404,{ok:false,error:'Unknown endpoint'});
    });
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','source-parity-ci-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/settings/team');
    return {page,ctx,calls};
  }
  for(const width of [390,1440]){
    await withCheck('Phase 8 original EmployeeDirectory renders server users and source controls '+width,async()=>{
      const f=await open({width});
      try{
        const p=f.page.locator('[data-live-team-settings]');
        await p.getByText('Verified Warehouse Keeper').waitFor({timeout:12000});
        assert.equal(await p.getByText('Mahmud Hasan').count(),0,'source demo employee must never leak');
        await p.getByRole('button',{name:'Columns'}).click();
        await f.page.getByRole('dialog',{name:'Employee columns'}).waitFor();
        await f.page.getByRole('dialog',{name:'Employee columns'}).getByRole('button',{name:'Done'}).click();
        await p.getByRole('button',{name:'Filters'}).click();
        await p.getByRole('combobox',{name:'Employee status'}).click();
        await f.page.getByRole('listbox',{name:'Employee status options'}).getByRole('option',{name:'Disabled'}).click();
        await p.getByText('Verified Office Operator').waitFor();
        assert.equal(await p.getByText('Verified Warehouse Keeper').count(),0);
        await p.getByRole('combobox',{name:'Employee status'}).click();
        await f.page.getByRole('listbox',{name:'Employee status options'}).getByRole('option',{name:'All statuses'}).click();
        await p.getByRole('textbox',{name:'Search employees'}).fill('Verified Warehouse Keeper');
        assert.equal(await p.getByText('Verified Office Operator').count(),0);
        await p.getByRole('button',{name:'View access for Verified Warehouse Keeper'}).click();
        await f.page.getByRole('dialog',{name:'Effective access: Verified Warehouse Keeper'}).waitFor();
        assert.equal(f.calls.filter(x=>x.path==='/api/users'&&x.method==='GET').length,1);
        assert.equal(f.calls.filter(x=>x.path==='/api/roles'&&x.method==='GET').length,1);
        assert.ok(f.calls.every(x=>x.method==='GET'),'source UI must remain read-only until full backend parity');
      }finally{await f.ctx.close();}
    });
  }
  await withCheck('Phase 8 original roles cards show real persisted role with no edit simulation',async()=>{
    const f=await open();
    try{
      const p=f.page.locator('[data-live-team-settings]');
      await p.getByRole('tab',{name:/Roles & permissions/}).click();
      await p.getByRole('heading',{name:'StockViewer'}).waitFor({timeout:12000});
      assert.equal(await p.getByRole('button',{name:/Create role|Edit role|Add demo employee/}).count(),0);
      assert.equal(await p.getByRole('heading',{name:'Manager'}).count(),0);
      assert.equal(f.calls.filter(x=>x.method!=='GET').length,0);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8 failing real Team API never displays fallback sample users or roles',async()=>{
    const f=await open({failUsers:true,failRoles:true});
    try{
      const p=f.page.locator('[data-live-team-settings]');
      await p.getByRole('alert').getByText('Employees database unavailable').waitFor({timeout:12000});
      await p.getByRole('tab',{name:/Roles & permissions/}).click();
      await p.getByRole('alert').getByText('Roles database unavailable').waitFor({timeout:12000});
      assert.equal(await p.getByText('Verified Warehouse Keeper').count(),0);
      assert.equal(await p.getByText('Mahmud Hasan').count(),0);
      assert.equal(await p.getByRole('button',{name:/Add demo employee|Create role/}).count(),0);
    }finally{await f.ctx.close();}
  });
}
