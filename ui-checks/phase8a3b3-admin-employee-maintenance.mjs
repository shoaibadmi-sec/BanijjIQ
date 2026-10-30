import assert from 'node:assert/strict';

/** Intercepted API browser contract; the real server controls RBAC and session revocation. */
export async function runAdminEmployeeMaintenanceChecks({browser,base,withCheck}){
  async function open({admin=true,editReject=false,statusReject=false,usersFail=false,initialStatus='Active',width=390}={}){
    const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const calls=[];
    const employees=[
      {id:'user-staff',name:'Existing Real Employee',mobile:'01000008301',
        role:'InventoryStaff',roleLabel:'InventoryStaff',status:initialStatus,createdAt:'2026-10-30'},
      {id:'user-owner',name:'Business Owner',mobile:'01000008300',
        role:'admin',roleLabel:'Administrator',status:'Active',createdAt:'2026-10-30'}
    ];
    await ctx.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
      calls.push({path,method,body:method==='PUT'?req.postDataJSON():null});
      const respond=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(path==='/api/auth/me')return respond(200,{ok:true,user:{
        userId:admin?'user-owner':'user-manager',fullName:'Current Operator',
        phone:'01000008300',role:admin?'admin':'manager',
        permissions:admin?null:{users:{view:true,edit:true,add:true},roles:{view:true}}
      }});
      if(path==='/api/users'&&method==='GET')return usersFail?
        respond(503,{ok:false,error:'User database temporarily unavailable'}):
        respond(200,{ok:true,users:employees,roles:[
          {name:'InventoryStaff',label:'InventoryStaff'},
          {name:'SalesStaff',label:'SalesStaff'}
        ],canAssignAdministrator:admin});
      if(path==='/api/roles'&&method==='GET')return respond(200,{ok:true,roles:[],
        moduleOptions:[{key:'products',label:'Products'}],deleteWindowOptions:[]});
      if(path==='/api/users/user-staff'&&method==='PUT'){
        if(!admin)return respond(403,{ok:false,error:'Administrator required'});
        if(editReject)return respond(400,{ok:false,error:'A user with this mobile number already exists.'});
        const value=req.postDataJSON();
        Object.assign(employees[0],{name:value.name,mobile:value.mobile,role:value.role,roleLabel:value.role});
        return respond(200,{ok:true,id:'user-staff'});
      }
      if(path==='/api/users/user-staff/status'&&method==='PUT'){
        if(!admin)return respond(403,{ok:false,error:'Administrator required'});
        if(statusReject)return respond(409,{ok:false,error:'Could not update employee status.'});
        employees[0].status=req.postDataJSON().status;
        return respond(200,{ok:true,id:'user-staff',status:employees[0].status});
      }
      return respond(404,{ok:false,error:'Unknown fixture API'});
    });
    await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ci-employee-maintenance-token'));
    const page=await ctx.newPage();
    await page.goto(base+'/#/app/settings/team');
    await page.locator('[data-live-team-settings]').waitFor({timeout:12000});
    return {ctx,page,calls,employees};
  }
  for(const width of [390,1440]){
    await withCheck('Phase 8A3B3 admin edits employee with one PUT and authoritative GET '+width,async()=>{
      const f=await open({width});
      try{
        await f.page.getByText('Existing Real Employee').waitFor();
        await f.page.getByRole('button',{name:'Edit Existing Real Employee'}).click();
        const dialog=f.page.getByRole('dialog',{name:'Edit employee'});
        assert.equal(await dialog.getByRole('textbox',{name:'Employee name'}).inputValue(),'Existing Real Employee');
        assert.equal(await dialog.getByRole('textbox',{name:'Mobile number'}).inputValue(),'01000008301');
        await dialog.getByRole('textbox',{name:'Employee name'}).fill('Updated Inventory Employee');
        await dialog.getByRole('textbox',{name:'Mobile number'}).fill('01000008302');
        await dialog.getByRole('combobox',{name:'Employee role'}).selectOption('SalesStaff');
        await dialog.getByRole('button',{name:'Save employee'}).click();
        await f.page.locator('[data-live-team-settings]').getByText('Updated Inventory Employee').waitFor({timeout:12000});
        assert.equal(await dialog.count(),0);
        assert.deepEqual(f.calls.filter(c=>c.path==='/api/users/user-staff'&&c.method==='PUT').map(c=>c.body),
          [{name:'Updated Inventory Employee',mobile:'01000008302',role:'SalesStaff'}]);
        assert.ok(f.calls.filter(c=>c.path==='/api/users'&&c.method==='GET').length>=2,
          'server reload required after successful edit');
        assert.equal(await f.page.locator('[data-live-team-settings]').getByText('Existing Real Employee').count(),0);
      }finally{await f.ctx.close();}
    });
  }
  await withCheck('Phase 8A3B3 status change requires confirmation; inactive user refreshed from API',async()=>{
    const f=await open();
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      await f.page.getByRole('button',{name:'Deactivate Existing Real Employee'}).click();
      const dialog=f.page.getByRole('dialog',{name:'Change employee status'});
      assert.equal(f.calls.filter(c=>c.method==='PUT').length,0,'no write before confirmation');
      await dialog.getByText(/Deactivate Existing Real Employee/).waitFor();
      await dialog.getByRole('button',{name:'Confirm deactivate'}).click();
      await f.page.getByRole('button',{name:'Activate Existing Real Employee'}).waitFor({timeout:12000});
      assert.deepEqual(f.calls.filter(c=>c.path==='/api/users/user-staff/status'&&c.method==='PUT').map(c=>c.body),
        [{status:'Inactive'}]);
      assert.ok(f.calls.filter(c=>c.path==='/api/users'&&c.method==='GET').length>=2);
      assert.equal(f.employees[0].status,'Inactive');
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B3 inactive employee can be reactivated with explicit consent',async()=>{
    const f=await open({initialStatus:'Inactive'});
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      await f.page.getByRole('button',{name:'Activate Existing Real Employee'}).click();
      const dialog=f.page.getByRole('dialog',{name:'Change employee status'});
      assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
      await dialog.getByRole('button',{name:'Confirm activate'}).click();
      await f.page.getByRole('button',{name:'Deactivate Existing Real Employee'}).waitFor({timeout:12000});
      assert.deepEqual(f.calls.filter(c=>c.path==='/api/users/user-staff/status'&&c.method==='PUT').map(c=>c.body),
        [{status:'Active'}]);
      assert.ok(f.calls.filter(c=>c.path==='/api/users'&&c.method==='GET').length>=2);
      assert.equal(f.employees[0].status,'Active');
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B3 cancel status confirmation performs no mutation',async()=>{
    const f=await open();
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      await f.page.getByRole('button',{name:'Deactivate Existing Real Employee'}).click();
      await f.page.getByRole('dialog',{name:'Change employee status'}).getByRole('button',{name:'Cancel'}).click();
      assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
      assert.equal(f.employees[0].status,'Active');
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B3 delegated user with users.edit has no maintenance controls',async()=>{
    const f=await open({admin:false});
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      assert.equal(await f.page.getByRole('button',{name:'Edit Existing Real Employee'}).count(),0);
      assert.equal(await f.page.getByRole('button',{name:'Deactivate Existing Real Employee'}).count(),0);
      assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B3 admin cannot edit or deactivate protected administrator from this UI',async()=>{
    const f=await open();
    try{
      await f.page.getByText('Business Owner').waitFor();
      assert.equal(await f.page.getByRole('button',{name:'Edit Business Owner'}).count(),0);
      assert.equal(await f.page.getByRole('button',{name:'Deactivate Business Owner'}).count(),0);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B3 edit errors leave source data intact and keep form visible',async()=>{
    const f=await open({editReject:true});
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      await f.page.getByRole('button',{name:'Edit Existing Real Employee'}).click();
      const dialog=f.page.getByRole('dialog',{name:'Edit employee'});
      await dialog.getByRole('textbox',{name:'Mobile number'}).fill('01000008309');
      await dialog.getByRole('button',{name:'Save employee'}).click();
      await dialog.getByRole('alert').getByText('A user with this mobile number already exists.').waitFor();
      assert.equal(f.employees[0].mobile,'01000008301');
      assert.equal(await dialog.getByRole('textbox',{name:'Mobile number'}).inputValue(),'01000008309');
      assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B3 status rejection retains active employee and confirmation',async()=>{
    const f=await open({statusReject:true});
    try{
      await f.page.getByText('Existing Real Employee').waitFor();
      await f.page.getByRole('button',{name:'Deactivate Existing Real Employee'}).click();
      const dialog=f.page.getByRole('dialog',{name:'Change employee status'});
      await dialog.getByRole('button',{name:'Confirm deactivate'}).click();
      await dialog.getByRole('alert').getByText('Could not update employee status.').waitFor();
      assert.equal(f.employees[0].status,'Active');
      assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
    }finally{await f.ctx.close();}
  });
  await withCheck('Phase 8A3B3 users API outage shows no editing controls or demo data',async()=>{
    const f=await open({usersFail:true});
    try{
      await f.page.getByRole('alert').getByText('User database temporarily unavailable').waitFor({timeout:12000});
      assert.equal(await f.page.getByRole('button',{name:/Edit Existing Real Employee/}).count(),0);
      assert.equal(await f.page.getByRole('button',{name:/Deactivate Existing Real Employee/}).count(),0);
      assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
    }finally{await f.ctx.close();}
  });
}
