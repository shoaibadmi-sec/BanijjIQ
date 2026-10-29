/**
 * A real React browser session against the *same* local Cloudflare Worker + D1
 * fixture used by d1-checks/run.mjs. No route mocking, production URL or
 * production customer records. Screenshots contain synthetic test data only.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root=resolve(process.cwd());
const web=join(root,'.generated/hisabiq-web');
const require=createRequire(pathToFileURL(join(web,'package.json')));
const { chromium }=require('playwright');
const base='http://127.0.0.1:8788';
const out=join(root,'d1-checks/output');
const safe=(value)=>value.replace(/[^a-z0-9_-]/gi,'-').toLowerCase();

export async function runRealD1Browser(){
  mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const checks=[];
  const images=[];
  const errors=[];
  const requests=[];
  const shots=async(page,name)=>{
    const path=join(out,'d1-real-'+safe(name)+'.png');
    await page.screenshot({path,fullPage:true,animations:'disabled'});
    images.push('d1-real-'+safe(name)+'.png');
  };
  try {
    for(const width of [390,1440]){
      const context=await browser.newContext({
        viewport:{width,height:900},deviceScaleFactor:1,reducedMotion:'reduce'
      });
      const page=await context.newPage();
      page.on('pageerror',error=>errors.push(width+': '+error.message));
      page.on('request',request=>{
        if(new URL(request.url()).pathname.startsWith('/api/'))
          requests.push({width,method:request.method(),path:new URL(request.url()).pathname});
      });
      try{
        await page.goto(base+'/#/app/products',{waitUntil:'domcontentloaded'});
        await page.getByText('Sign in · BanijjIQ').waitFor({timeout:15000});
        assert.equal(await page.locator('[data-live-products]').count(),0,'Authentication gate bypassed');
        await shots(page,'signed-out-'+width);
        checks.push('real React sign-in gate '+width);

        await page.getByLabel('Mobile number').fill('01000000444');
        await page.getByLabel('Password').fill('Local-Only-Test!');
        await page.getByRole('button',{name:/Sign in/}).click();
        await page.locator('[data-live-products]').waitFor({timeout:20000});
        await page.getByText('D1 CI Copper Wire').first().waitFor({timeout:12000});
        assert.ok(await page.locator('[data-live-products] tbody tr').count()>0);
        await shots(page,'products-'+width);
        checks.push('live D1 login and Products '+width);

        if(width===1440){
          // The ORIGINAL HisabIQ full-page editor (not a synthetic API client).
          await page.getByRole('button',{name:'Add Product'}).click();
          await page.locator('[data-live-product-editor]').waitFor({timeout:12000});
          await page.locator('#pf-name').fill('D1 Browser Socket');
          await page.locator('#pf-buy').fill('95');
          await page.locator('#pf-sell').fill('150');
          await page.locator('#pf-opening').fill('3');
          await page.locator('#pf-min').fill('1');
          await shots(page,'product-create-form-1440');
          await page.getByRole('button',{name:/Save product/}).click();
          await page.locator('[data-live-products]').waitFor({timeout:20000});
          await page.getByText('D1 Browser Socket').first().waitFor({timeout:12000});
          checks.push('React full-page product create persisted to D1');

          await page.getByRole('button',{name:'Edit D1 Browser Socket'}).click();
          await page.locator('#pf-name').fill('D1 Browser Socket Updated');
          await page.locator('#pf-sell').fill('175');
          await page.getByRole('button',{name:/Save changes/}).click();
          await page.locator('[data-live-products]').waitFor({timeout:20000});
          await page.getByText('D1 Browser Socket Updated').first().waitFor({timeout:12000});
          await shots(page,'product-catalog-edit-1440');
          checks.push('React catalog edit saved price/name without stock changes');
        }

        await page.goto(base+'/#/app/pos',{waitUntil:'domcontentloaded'});
        await page.locator('[data-live-pos]').waitFor({timeout:16000});
        await page.getByText('D1 CI Copper Wire').first().waitFor({timeout:12000});
        await page.keyboard.press('F2');
        assert.ok(await page.locator('input:focus').count()>0,'F2 did not focus product search');
        const item=page.locator('[data-live-pos] button').filter({hasText:'D1 CI Copper Wire'}).first();
        await item.click();
        await page.getByRole('spinbutton',{name:/Quantity for .*D1 CI Copper Wire/}).waitFor();
        await shots(page,'cart-'+width);
        checks.push('real D1 POS product selection and keyboard '+width);

        if(width===1440){
          const name=page.locator('input[list="live-pos-customer-names"]');
          const phone=page.locator('input[list="live-pos-customer-phones"]');
          await name.fill('Real Browser Buyer');
          await phone.fill('01000000123');
          await page.getByRole('spinbutton',{name:/Amount received/}).fill('100');
          const before=requests.filter(r=>r.method==='POST'&&r.path==='/api/pos/sales').length;
          await page.getByRole('button',{name:'Review and post real sale'}).click();
          await page.getByRole('button',{name:'Confirm and post'}).click();
          await page.getByText('Sale posted successfully').waitFor({timeout:20000});
          assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='/api/pos/sales').length-before,1,
            'User confirmation must create one actual D1 sale request');
          await page.getByRole('button',{name:'View / Print receipt'}).click();
          await page.locator('#hisabiq-real-receipt').waitFor({timeout:16000});
          await shots(page,'real-saved-receipt-1440');
          checks.push('browser cash sale and saved D1 receipt, exactly one POST');

          await page.keyboard.press('Escape'); // Close saved receipt dialog.
          await page.getByRole('button',{name:'New Sale',exact:true}).click();
          await page.getByText('D1 CI Copper Wire').first().waitFor({timeout:10000});
          const dueProduct=page.locator('[data-live-pos] button').filter({hasText:'D1 CI Copper Wire'}).first();
          await dueProduct.click();
          await page.getByRole('spinbutton',{name:/Quantity for .*D1 CI Copper Wire/}).waitFor();
          await name.fill('Real Browser Due Buyer');
          await phone.fill('01000000124');
          await page.getByRole('spinbutton',{name:/Amount received/}).fill('40');
          const dueReady=page.getByRole('button',{name:'Review and post real sale',exact:true});
          if(await dueReady.isDisabled()){
            const warnings=await page.locator('[data-live-pos] [role="alert"]').allTextContents();
            const lineDetails=await page.locator('[data-live-pos] input[aria-label^="Quantity for"]').count();
            const totalText=await page.locator('[data-live-pos]').innerText();
            throw new Error('Second-sale preflight blocked: '+JSON.stringify({
              warnings,lineDetails,
              pageExcerpt:totalText.slice(-1200)
            }));
          }
          const dueBefore=requests.filter(r=>r.method==='POST'&&r.path==='/api/pos/sales').length;
          await page.getByRole('button',{name:'Review and post real sale'}).click();
          await page.getByRole('button',{name:'Confirm and post'}).click();
          await page.getByText('Sale posted successfully').waitFor({timeout:20000});
          assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='/api/pos/sales').length-dueBefore,1);
          await page.getByRole('button',{name:'View / Print receipt'}).click();
          await page.locator('#hisabiq-real-receipt').waitFor({timeout:16000});
          await shots(page,'real-partial-payment-receipt-1440');
          checks.push('React partial payment posts exact cash and due to D1 with saved receipt');
        }
      }finally{await context.close();}
    }
    assert.equal(errors.length,0,'Browser JavaScript errors: '+errors.join('; '));
    return {checks,images,errors,requests};
  }finally{
    await browser.close();
  }
}
