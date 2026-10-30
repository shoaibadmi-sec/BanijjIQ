import assert from 'node:assert/strict';

export async function runNativePartySourceChecks({browser,base,withCheck,results,startMocking,screenshot,audit}){
 for(const width of [390,768,1440]){
  await withCheck('4L original Party screen reads D1 supplier ledger '+width,async()=>{
   const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   const calls=[];await startMocking(ctx,calls);
   const respond=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',
    body:JSON.stringify(data)});
   await ctx.route('**/api/customers',route=>respond(route,{ok:true,customers:[
    {id:'CUS-UI-001',name:'Rahima API Customer',phone:'01711111111',status:'Active',currentDue:120}]}));
   await ctx.route('**/api/suppliers',route=>respond(route,{ok:true,suppliers:[
    {id:'SUP-UI-001',name:'Khan Source Hardware',phone:'01811111111',status:'Active',currentDue:75}]}));
   await ctx.route('**/api/suppliers/SUP-UI-001',route=>{
    calls.push({method:route.request().method(),path:'/api/suppliers/SUP-UI-001'});
    return respond(route,{ok:true,supplier:{id:'SUP-UI-001',name:'Khan Source Hardware',
      currentDue:75},ledger:[
       {ledgerId:'LED-UI-01',date:'2026-10-28',type:'Purchase',reference:'PUR-SOURCE-001',
        debit:100,credit:0,notes:''},
       {ledgerId:'LED-UI-02',date:'2026-10-29',type:'Payment',reference:'PAY-SOURCE-001',
        debit:0,credit:25,notes:''}]});
   });
   await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
   const page=await ctx.newPage();page.on('pageerror',e=>results.consoleErrors.push('native-party-'+width+': '+e.message));
   await page.goto(base+'/#/app/parties?id=Supplier%3ASUP-UI-001&role=Supplier');
   await page.locator('[data-live-native-parties]').waitFor({timeout:12000});
   await page.getByText('Khan Source Hardware').first().waitFor({timeout:12000});
   await page.getByText('PUR-SOURCE-001').first().waitFor({timeout:12000});
   await page.getByText(/Live ledger \(read-only\)/).waitFor();
   assert.ok(calls.some(x=>x.path==='/api/suppliers/SUP-UI-001'&&x.method==='GET'),
    'Detail must load original supplier D1 ledger');
   assert.equal(calls.filter(x=>['POST','PUT','DELETE','PATCH'].includes(x.method)).length,0,
    'Opening Party statement never posts demo transactions');
   assert.ok(!(await page.locator('[data-live-native-parties]').innerText()).includes('Bismillah Steel House'),
    'Sample Party must not be displayed as real');
   if(width===390){await screenshot(page,'phase4l-native-party-390');await audit(page,'phase4l-native-party-390');}
   results.apiCalls.push(...calls);await ctx.close();
  });
 }
 await withCheck('4L supplier ledger API failure shows error, never demo fallback',async()=>{
  const ctx=await browser.newContext({viewport:{width:768,height:900},reducedMotion:'reduce'});
  await startMocking(ctx,[]);
  const respond=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',
   body:JSON.stringify(body)});
  await ctx.route('**/api/customers',route=>respond(route,{ok:true,customers:[]}));
  await ctx.route('**/api/suppliers',route=>respond(route,{ok:true,suppliers:[{
   id:'SUP-UI-001',name:'Khan Source Hardware',phone:'01811111111',currentDue:75,status:'Active'}]}));
  await ctx.route('**/api/suppliers/SUP-UI-001',route=>respond(route,{
   ok:false,error:'Supplier source temporarily unavailable'},503));
  await ctx.addInitScript(()=>localStorage.setItem('shererp_auth_token','ui-e2e-only-token'));
  const page=await ctx.newPage();await page.goto(base+'/#/app/parties?id=Supplier%3ASUP-UI-001&role=Supplier');
  await page.getByRole('alert').getByText('Supplier source temporarily unavailable').waitFor({timeout:12000});
  assert.equal(await page.getByText('PUR-SOURCE-001').count(),0);
  await ctx.close();
 });
}
