/**
 * Post-deploy smoke against the one fixed-name preview Worker.
 * NEVER executes sale or writes any production/preview business transaction.
 * Creates a preview-only administrator on first launch, if setup is required.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerName='banijjiq-hisabiq-react-preview';
const env=process.env;
const required=[
  'CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','HISABIQ_PREVIEW_D1_ID',
  'HISABIQ_PREVIEW_SETUP_SECRET','HISABIQ_PREVIEW_ADMIN_PHONE','HISABIQ_PREVIEW_ADMIN_PASSWORD'
];
for(const key of required)assert.ok(env[key]?.trim(),key+' is required in the approved preview environment');
assert.ok(env.HISABIQ_PREVIEW_ADMIN_PASSWORD.length>=12,
  'Use a strong preview-only admin password, at least 12 characters');
const accountId=env.CLOUDFLARE_ACCOUNT_ID.trim();
assert.match(accountId,/^[a-f0-9]{32}$/i);
const dns=await fetch('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/subdomain',{
  headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN},
  signal:AbortSignal.timeout(12000)
});
assert.ok(dns.ok,'Cannot read Cloudflare Workers subdomain; check token permissions');
const body=await dns.json();
assert.ok(body.success,'Cloudflare subdomain API returned failure');
const suffix=String(body.result?.subdomain||'');
assert.match(suffix,/^[a-z0-9-]+$/i,'Unexpected Workers subdomain response');
const url='https://'+workerName+'.'+suffix+'.workers.dev';
assert.equal(new URL(url).hostname.split('.')[0],workerName);
const result={startedAt:new Date().toISOString(),url,passed:[],failed:[]};
async function call(method,path,{json,authorization,setupSecret}={}){
  const headers={Accept:'application/json'};
  if(json!==undefined)headers['Content-Type']='application/json';
  if(authorization)headers.Authorization='Bearer '+authorization;
  if(setupSecret)headers['x-setup-secret']=env.HISABIQ_PREVIEW_SETUP_SECRET;
  const response=await fetch(url+path,{
    method,headers,body:json===undefined?undefined:JSON.stringify(json),
    redirect:'error',signal:AbortSignal.timeout(16000)
  });
  let payload;
  try{payload=await response.json();}
  catch{throw new Error(path+' must return JSON, got HTTP '+response.status);}
  return {status:response.status,...payload};
}
async function check(label,fn){
  try{await fn();result.passed.push(label);console.log('PASS '+label);}
  catch(error){result.failed.push({label,error:String(error?.message||error)});throw error;}
}
try{
  await check('hosted preview health',async()=>{
    const h=await call('GET','/api/health');
    assert.ok(h.ok,'Preview Worker returned no API health');
  });
  await check('public setup secret is required',async()=>{
    const status=await call('GET','/api/setup/status');
    assert.equal(status.ok,true);
    const denied=await call('POST','/api/setup/admin',{
      fullName:'Disallowed Test',phone:'000',password:'NotUsedTest123!'
    });
    assert.equal(denied.status,403,'Public setup must never accept missing secret');
  });
  await check('initialize isolated administrator only when new',async()=>{
    const status=await call('GET','/api/setup/status');
    if(status.setupRequired){
      const setup=await call('POST','/api/setup/admin',{
        fullName:'Preview Administrator',
        phone:env.HISABIQ_PREVIEW_ADMIN_PHONE,
        password:env.HISABIQ_PREVIEW_ADMIN_PASSWORD
      },{setupSecret:true});
      assert.equal(setup.ok,true,'Preview admin setup failed, status '+setup.status);
    }else console.log('Existing preview admin preserved; no password reset.');
  });
  let token='';
  await check('authenticate with preview-only credentials',async()=>{
    const response=await call('POST','/api/auth/login',{
      phone:env.HISABIQ_PREVIEW_ADMIN_PHONE,
      password:env.HISABIQ_PREVIEW_ADMIN_PASSWORD
    });
    assert.equal(response.ok,true,'Preview login failed, status '+response.status);
    assert.ok(response.token,'Missing authentication token');
    assert.equal(response.user?.role,'admin');
    token=response.token; // only held in memory, never printed or saved
  });
  await check('authenticated Products, POS and permissions',async()=>{
    const me=await call('GET','/api/auth/me',{authorization:token});
    assert.equal(me.user?.role,'admin');
    const products=await call('GET','/api/bootstrap',{authorization:token});
    assert.ok(Array.isArray(products.products));
    const pos=await call('GET','/api/pos/bootstrap',{authorization:token});
    assert.ok(Array.isArray(pos.products));
    assert.ok(Array.isArray(pos.customers));
  });
  await check('published frontend is a React HTML document',async()=>{
    const page=await fetch(url+'/',{signal:AbortSignal.timeout(16000)});
    assert.ok(page.ok,'React frontend failed at '+url);
    const html=await page.text();
    assert.ok(/<html|<!doctype html/i.test(html),'Worker did not serve frontend HTML');
  });
}catch(e){
  result.failed.push({label:'runner',error:String(e?.message||e)});
}finally{
  result.finishedAt=new Date().toISOString();
  const out=resolve('preview-checks/output');
  mkdirSync(out,{recursive:true});
  writeFileSync(out+'/hosted-smoke.json',JSON.stringify(result,null,2)+'\n');
  if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,
    '\n## HisabIQ isolated React preview\n\n'+
    'Worker: **'+workerName+'**\n\n'+
    'URL: '+url+'\n\n'+
    'Smoke checks: '+result.passed.length+' passed, '+result.failed.length+' failed.\n\n'+
    'Only an isolated preview D1 was used; no production deployment.\n');
}
if(result.failed.length)process.exitCode=1;
else console.log('Preview verified at '+url);
