/**
 * Phase 14 preview acceptance: REAL read-only Chromium against a verified
 * isolated preview Worker, or an explicit 127.0.0.1:8793 local D1 rehearsal.
 *
 * No API mocks; all product, POS and returns reads hit the selected Worker.
 * No sales, returns, cash sessions, vendors, or inventory mutations allowed.
 * Never print/log/sign secrets, tokens, phone numbers or passwords.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=resolve(process.cwd());
const web=join(root,'.generated/hisabiq-web');
const workerName='banijjiq-hisabiq-react-preview';
const restricted=/^\/api\/(?:pos\/sales(?:\/|$)|sales-returns(?:\/|$)|pos\/vendors(?:\/|$)|pos\/cash-session(?:\/|$)|products(?:\/|$))/;
const auditTag=['wcag2a','wcag2aa','wcag21a','wcag21aa'];

function assertAllowedUrl(value,allowLocal){
  const url=new URL(value);
  if(allowLocal && url.origin==='http://127.0.0.1:8793')return url.origin;
  assert.equal(url.protocol,'https:','Hosted acceptance requires HTTPS');
  assert.match(url.hostname,/^banijjiq-hisabiq-react-preview\.[a-z0-9-]+\.workers\.dev$/i,
    'Only the dedicated preview Worker may be audited');
  assert.equal(url.pathname,'/','Only a preview Worker origin is allowed');
  assert.ok(!url.search&&!url.hash);
  return url.origin;
}
const clean=s=>String(s).replace(/[^a-z0-9_-]/gi,'-').toLowerCase();

export async function runBrowserAcceptance({
  baseUrl,phone,password,browser,outputDir=join(root,'preview-checks/output'),allowLocal=false
}){
  const base=assertAllowedUrl(baseUrl,allowLocal);
  assert.ok(browser,'A Playwright Chromium browser instance is required');
  assert.ok(phone && password,'Isolated preview authentication is required');
  mkdirSync(outputDir,{recursive:true});
  const result={mode:allowLocal?'local-rehearsal':'hosted-read-only',baseUrl:base,
    startedAt:new Date().toISOString(),screenshots:[],layouts:[],accessibility:[],
    apiRequests:[],blockedWrites:[],browserErrors:[],passed:[],failed:[]};
  async function verify(label,fn){
    try{await fn();result.passed.push(label);console.log('PASS preview acceptance '+label);}
    catch(e){result.failed.push({label,error:String(e?.message||e)});throw e;}
  }
  async function layout(page,screen,selector){
    const info=await page.evaluate(sel=>{
      const element=document.querySelector(sel),rect=element?.getBoundingClientRect();
      return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
        screen:location.hash,workspaceWidth:rect?.width||0,
        workspaceLeft:rect?.left||0};
    },selector);
    result.layouts.push({screen,...info});
    assert.ok(info.workspaceWidth>150,screen+' workspace missing');
    assert.ok(info.documentWidth<=info.viewport+4,
      screen+' page overflows horizontally: '+JSON.stringify(info));
  }
  async function audit(page,screen,selector){
    const script=join(web,'node_modules/axe-core/axe.min.js');
    assert.ok(existsSync(script),'Build React dependencies before browser acceptance (axe-core missing)');
    await page.addScriptTag({content:readFileSync(script,'utf8')});
    const resultAxe=await page.evaluate(async(arg)=>{
      const r=await window.axe.run(document.querySelector(arg.selector),
        {runOnly:{type:'tag',values:arg.tags}});
      return {passedRules:r.passes.length,
        violations:r.violations.map(v=>({id:v.id,impact:v.impact,
          nodes:v.nodes.slice(0,5).map(n=>({target:n.target}))}))};
    },{selector,tags:auditTag});
    result.accessibility.push({screen,...resultAxe});
    assert.equal(resultAxe.violations.filter(v=>v.impact==='critical').length,0,
      screen+' contains critical WCAG violations');
  }
  async function screenshot(page,screen){
    const file='preview-acceptance-'+clean(screen)+'.png';
    await page.screenshot({path:join(outputDir,file),fullPage:true,animations:'disabled'});
    result.screenshots.push(file);
  }
  let completed=false;
  try{
    for(const width of [390,768,1440]){
      const ctx=await browser.newContext({viewport:{width,height:960},
        deviceScaleFactor:1,reducedMotion:'reduce',
        colorScheme:width===390?'dark':'light'});
      // Network policy: never permit business writes even if an unintended
      // component renders. POST is allowed ONLY for login.
      await ctx.route('**/api/**',async route=>{
        const request=route.request(),uri=new URL(request.url()),method=request.method();
        const permitted=uri.origin===base && (method==='GET' ||
          (method==='POST'&&uri.pathname==='/api/auth/login'));
        if(!permitted){
          result.blockedWrites.push({width,method,path:uri.pathname});
          await route.abort('blockedbyclient');
          return;
        }
        result.apiRequests.push({width,method,path:uri.pathname});
        await route.continue();
      });
      const page=await ctx.newPage();
      page.on('pageerror',e=>result.browserErrors.push({width,message:e.message}));
      page.on('response',response=>{
        const uri=new URL(response.url());
        if(uri.origin===base && uri.pathname.startsWith('/api/') && response.status()>=500)
          result.browserErrors.push({width,message:'API 5xx '+uri.pathname});
      });
      try{
        await verify('signed-out gate at '+width+'px',async()=>{
          await page.goto(base+'/#/app/pos',{waitUntil:'domcontentloaded'});
          await page.getByText('Sign in · BanijjIQ').waitFor({timeout:20000});
          assert.equal(await page.locator('[data-live-pos]').count(),0,
            'Live POS must never render outside the authentication gate');
        });
        await verify('real preview sign-in at '+width+'px',async()=>{
          await page.getByLabel('Mobile number').fill(phone);
          await page.getByLabel('Password').fill(password);
          await page.getByRole('button',{name:/Sign in/}).click();
          await page.locator('[data-live-pos]').waitFor({timeout:20000});
          // The POS section mounts before its asynchronous /api/pos/bootstrap read.
          // Wait for the cash-session strip instead of checking its count immediately.
          await page.locator('[data-live-pos]').getByText(/Cash session:/).first().waitFor({timeout:30000});
        });
        await verify('read-only POS, keyboard and accessibility '+width+'px',async()=>{
          await layout(page,'pos-'+width,'[data-live-pos]');
          await page.keyboard.press('F2');
          assert.ok(await page.locator('input:focus').count()>0,'F2 must focus product search');
          await page.keyboard.press('Escape');
          await audit(page,'pos-'+width,'[data-live-pos]');
          await screenshot(page,'pos-'+width);
        });
        await verify('read-only Products and permissions '+width+'px',async()=>{
          await page.goto(base+'/#/app/products',{waitUntil:'domcontentloaded'});
          await page.locator('[data-live-products]').waitFor({timeout:20000});
          await layout(page,'products-'+width,'[data-live-products]');
          await screenshot(page,'products-'+width);
        });
        await verify('read-only Sales Returns '+width+'px',async()=>{
          await page.goto(base+'/#/app/live-sales-returns',{waitUntil:'domcontentloaded'});
          await page.locator('[data-live-sales-returns]').waitFor({timeout:20000});
          await layout(page,'returns-'+width,'[data-live-sales-returns]');
          await audit(page,'returns-'+width,'[data-live-sales-returns]');
          await screenshot(page,'returns-'+width);
        });
      } finally {await ctx.close();}
    }
    assert.equal(result.blockedWrites.length,0,'Unexpected business write was blocked');
    assert.equal(result.browserErrors.length,0,'Browser/Worker errors during preview acceptance');
    completed=true;
  }catch(e){
    result.failed.push({label:'runner',error:String(e?.message||e)});
  }finally{
    result.finishedAt=new Date().toISOString();
    const file=join(outputDir,allowLocal?'phase14-local-browser-acceptance.json':'hosted-browser-acceptance.json');
    writeFileSync(file,JSON.stringify(result,null,2)+'\n');
  }
  if(!completed)throw Error('Preview browser acceptance failed: '+
    result.failed.map(f=>f.label+': '+f.error).join('; '));
  return result;
}

async function remoteOrigin(){
  const account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim();
  assert.match(account,/^[a-f0-9]{32}$/i,'Preview Cloudflare account ID required');
  assert.ok(token,'Preview-scoped Cloudflare API token required');
  const response=await fetch(
    'https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/subdomain',
    {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(14000)}
  );
  assert.equal(response.ok,true,'Cannot resolve the dedicated preview Workers subdomain');
  const payload=await response.json();
  assert.equal(payload.success,true,'Cloudflare Workers subdomain API returned failure');
  const suffix=String(payload.result?.subdomain||'');
  assert.match(suffix,/^[a-z0-9-]+$/i,'Invalid Cloudflare Workers subdomain');
  return 'https://'+workerName+'.'+suffix+'.workers.dev';
}

// CLI runs ONLY with explicit --remote and environment-protected secrets.
// Importing this module for isolated local CI never calls Cloudflare.
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.deepEqual(process.argv.slice(2),['--remote'],
    'Hosted browser acceptance requires explicit --remote');
  const phone=(process.env.HISABIQ_PREVIEW_ADMIN_PHONE||'').trim();
  const password=process.env.HISABIQ_PREVIEW_ADMIN_PASSWORD||'';
  assert.ok(phone&&password.length>=12,'Preview-only admin credentials required');
  const baseUrl=await remoteOrigin();
  const require=createRequire(pathToFileURL(join(web,'package.json')));
  const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const r=await runBrowserAcceptance({baseUrl,phone,password,browser});
    console.log('PASS hosted preview Chromium: '+r.passed.length+
      ' read-only checks, '+r.accessibility.length+' WCAG audits, '+r.screenshots.length+' screenshots');
  }finally{await browser.close();}
}
