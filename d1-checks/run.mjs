/**
 * No credentials and no remote D1: all requests hit a fresh Wrangler --local
 * Worker + D1 fixture. The config cannot address production D1.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runRealD1Browser } from './browser.mjs';

const base='http://127.0.0.1:8788';
const root=resolve(process.cwd());
const config=join(root,'wrangler.d1-ci.jsonc');
const fixture=JSON.parse(readFileSync(config,'utf8'));
const production=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
assert.notEqual(fixture.name,production.name);
assert.notEqual(fixture.d1_databases[0].database_id,production.d1_databases[0].database_id);
assert.equal(fixture.d1_databases[0].database_id,'11111111-1111-4111-8111-111111111111');
const pkg=JSON.parse(readFileSync(join(root,'node_modules/wrangler/package.json'),'utf8'));
const cliPath=join(root,'node_modules/wrangler',
  typeof pkg.bin==='string'?pkg.bin:pkg.bin.wrangler);
const setupSecret='LOCAL-CI-ONLY-NOT-A-PRODUCTION-SECRET';
const state=mkdtempSync(join(tmpdir(),'banijjiq-d1-ci-'));
const out=join(root,'d1-checks/output');
mkdirSync(out,{recursive:true});
const report={startedAt:new Date().toISOString(),passed:[],failed:[],requests:[],
  source:'Wrangler local Worker + isolated D1; no remote bindings',dbName:fixture.d1_databases[0].database_name};
let logs='';
let worker;

function wrangler(args,{json=false}={}){
  // Never change any of these flags; Wrangler defaults are NOT safe for isolation.
  assert.ok(args.some(x=>x==='--local'),'D1 command must be --local');
  assert.ok(args.includes('--persist-to'),'D1 command must have isolated persistence');
  assert.ok(!args.includes('--remote'),'Remote D1 forbidden in CI');
  const result=spawnSync(process.execPath,[cliPath,...args,'--config',config],
    {cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('Local Wrangler failed: '+(result.stderr||result.stdout).slice(-8000));
  return result.stdout;
}
function query(sql){
  const stdout=wrangler(['d1','execute','DB','--local','--persist-to',state,
    '--json','--command',sql]);
  // Wrangler may include CLI status before a JSON array; find first '['.
  const start=stdout.indexOf('[');
  if(start<0)throw new Error('Expected Wrangler JSON result; got '+stdout.slice(-1200));
  const parsed=JSON.parse(stdout.slice(start));
  return parsed[0]?.results||[];
}
async function request(method,path,body,opts={}){
  const headers={'content-type':'application/json',...(opts.token?{authorization:'Bearer '+opts.token}:{}),
    ...(opts.setupSecret?{'x-setup-secret':setupSecret}:{})};
  const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(16000)});
  const text=await res.text();
  let result;
  try{result=JSON.parse(text);}catch{throw new Error('Invalid JSON from '+path+' status '+res.status+': '+text.slice(0,250));}
  report.requests.push({method,path,status:res.status});
  return {status:res.status,...result};
}
async function check(name,fn){
  try{await fn();report.passed.push(name);process.stdout.write('PASS '+name+'\n');}
  catch(err){report.failed.push({name,message:String(err?.stack||err)});process.stderr.write('FAIL '+name+': '+err+'\n');
    throw err;}
}
async function waitForServer(){
  for(let i=0;i<100;i++){
    if(worker.exitCode!==null)throw new Error('Worker exited early ('+worker.exitCode+'): '+logs.slice(-3000));
    try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});if(response.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,350));
  }
  throw new Error('Local Worker never started: '+logs.slice(-5000));
}
const product={
  productName:'D1 CI Copper Wire',brand:'E2E Brand',category:'Electrical',
  unit:'Pcs',barcode:'D1-CI-001',purchasePrice:60,sellingPrice:100,
  currentStock:9,minimumStock:2,status:'Active',
  trackSerial:false,trackExpiry:false,trackWarranty:false
};
let token='',productId='',paidInvoice='',partialInvoice='';
try{
  await check('local D1 runs every SQL migration',async()=>{
    const out=wrangler(['d1','migrations','apply','DB','--local','--persist-to',state]);
    assert.match(out,/0028_pos_sale_idempotency|pos_sale_idempotency/);
    assert.ok(query("SELECT name FROM sqlite_master WHERE type='table' AND name='pos_sale_requests'").length);
    assert.ok(query("SELECT name FROM sqlite_master WHERE type='table' AND name='sales'").length);
  });
  worker=spawn(process.execPath,[cliPath,'dev',
    '--config',config,'--local','--persist-to',state,
    '--ip','127.0.0.1','--port','8788',
    '--var','SETUP_SECRET:'+setupSecret],{
    cwd:root,stdio:['ignore','pipe','pipe'],
    env:{...process.env,CI:'true',CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}
  });
  for(const stream of [worker.stdout,worker.stderr])
    stream.on('data',chunk=>{logs=(logs+String(chunk)).slice(-24000);});
  await waitForServer();

  await check('real Hono Worker blocks unauthorized actions and setup hijack',async()=>{
    const noAuth=await request('GET','/api/pos/bootstrap');
    assert.equal(noAuth.status,401);
    const denied=await request('POST','/api/setup/admin',{
      fullName:'Test Admin',phone:'01000000444',password:'Local-Only-Test!'
    });
    assert.equal(denied.status,403);
    const setup=await request('POST','/api/setup/admin',{
      fullName:'Test Admin',phone:'01000000444',password:'Local-Only-Test!'
    },{setupSecret:true});
    assert.equal(setup.ok,true,JSON.stringify(setup));
    assert.ok(setup.token);
    token=setup.token;
    assert.equal((await request('GET','/api/auth/me',undefined,{token})).user.fullName,'Test Admin');
  });
  await check('real Worker creates product and opening FIFO inventory',async()=>{
    const added=await request('POST','/api/products',product,{token});
    assert.equal(added.ok,true,JSON.stringify(added));
    productId=added.productId;
    const boot=await request('GET','/api/bootstrap',undefined,{token});
    const p=boot.products.find(x=>x.productId===productId);
    assert.equal(Number(p.currentStock),9);
    const pos=await request('GET','/api/pos/bootstrap',undefined,{token});
    assert.equal(Number(pos.products.find(x=>x.id===productId).stock),9);
  });
  await check('cannot sell before session, then opens one valid session',async()=>{
    const payload={clientRequestId:'d1-ci-closed-session-001',
      customerName:'No Session Buyer',customerPhone:'01000000555',
      discount:0,paymentType:'Cash',paidAmount:0,paymentMethod:'Cash',
      items:[{productId,name:'D1 CI Copper Wire',qty:1,unitPrice:100,fulfillmentMode:'own'}]};
    assert.equal((await request('POST','/api/pos/sales',payload,{token})).ok,false);
    const session=await request('POST','/api/pos/cash-session/start',{openingCash:300},{token});
    assert.equal(session.ok,true,JSON.stringify(session));
    assert.equal((await request('POST','/api/pos/cash-session/start',{openingCash:300},{token})).ok,false);
  });
  const sale=(key,qty,paymentType,paidAmount,phone)=>({
    clientRequestId:key,customerName:'D1 Test Customer',customerPhone:phone,
    discount:0,paymentType,paidAmount,paymentMethod:'Cash',
    items:[{productId,name:'D1 CI Copper Wire',qty,unitPrice:100,fulfillmentMode:'own'}]
  });
  const paid=sale('d1-ci-cash-sale-00001',2,'Cash',0,'01000000666');
  await check('cash sale commits invoice/receipt and deducted stock',async()=>{
    const r=await request('POST','/api/pos/sales',paid,{token});
    assert.equal(r.ok,true,JSON.stringify(r));
    paidInvoice=r.invoice.invoiceId;
    assert.equal(r.invoice.grandTotal,200);
    assert.equal(r.invoice.paidAmount,200);
    const invoice=await request('GET','/api/pos/invoices/'+encodeURIComponent(paidInvoice),undefined,{token});
    assert.equal(invoice.invoice.items[0].quantity,2);
    const bootstrap=await request('GET','/api/bootstrap',undefined,{token});
    assert.equal(Number(bootstrap.products.find(p=>p.productId===productId).currentStock),7);
  });
  await check('replayed key returns original invoice; mismatch returns HTTP 409',async()=>{
    const replay=await request('POST','/api/pos/sales',paid,{token});
    assert.equal(replay.invoice.invoiceId,paidInvoice);
    const mismatch=await request('POST','/api/pos/sales',{...paid,discount:1},{token});
    assert.equal(mismatch.status,409);
  });
  await check('partial sale creates due account and ledger through Worker',async()=>{
    const r=await request('POST','/api/pos/sales',
      sale('d1-ci-partial-sale-002',2,'Partial',80,'01000000777'),{token});
    assert.equal(r.ok,true,JSON.stringify(r));
    partialInvoice=r.invoice.invoiceId;
    assert.equal(r.invoice.paidAmount,80);
    assert.equal(r.invoice.dueAmount,120);
    const recent=await request('GET','/api/pos/sales-by-phone?phone=01000000777',undefined,{token});
    assert.ok(recent.sales.some(x=>x.invoiceId===partialInvoice));
  });
  await check('real D1 reports verify permissions, source parity and no writes',async()=>{
    const range='&from=2026-01-01&to=2026-12-31';
    const reportBefore=query("SELECT (SELECT COUNT(*) FROM sales) sales,(SELECT COUNT(*) FROM cash_book) cash,(SELECT COUNT(*) FROM stock_lots) lots,(SELECT COUNT(*) FROM customer_ledger) ledger")[0];
    for(const path of ['/api/reports/v2/catalog','/api/reports/v2/summary',
      '/api/reports/v2/rows?report=sales','/api/reports/v2/audit'])
      assert.equal((await request('GET',path)).status,401,'reports require authentication: '+path);
    // Exercise real user/role/session endpoints instead of running a second
    // Wrangler D1 CLI writer against the live local Worker process. This
    // tests authenticated RBAC and avoids concurrent SQLite file mutation.
    const limitedRole=await request('POST','/api/roles',{
      name:'D1 Restricted Reports Viewer',permissions:{products:{view:true}}
    },{token});
    assert.equal(limitedRole.status,200,JSON.stringify(limitedRole));
    const limitedUser=await request('POST','/api/users',{
      name:'Restricted Reporter',mobile:'01000000987',
      role:'D1 Restricted Reports Viewer',password:'D1-Reports-Test-Only-2026!'
    },{token});
    assert.equal(limitedUser.status,200,JSON.stringify(limitedUser));
    const limitedLogin=await request('POST','/api/auth/login',{
      phone:'01000000987',password:'D1-Reports-Test-Only-2026!'
    });
    assert.equal(limitedLogin.status,200,JSON.stringify(limitedLogin));
    const limitedToken=limitedLogin.token;
    assert.ok(limitedToken,'restricted session must be issued by the real Worker');
    for(const path of ['/api/reports/v2/catalog','/api/reports/v2/summary',
      '/api/reports/v2/rows?report=stock','/api/reports/v2/audit'])
      assert.equal((await request('GET',path,undefined,{token:limitedToken})).status,403,
        'RBAC must reject access to '+path);
    const catalog=await request('GET','/api/reports/v2/catalog',undefined,{token});
    assert.equal(catalog.status,200,JSON.stringify(catalog));
    assert.deepEqual(catalog.mainTabs.map(t=>t.id),['overview','library']);
    const sales=await request('GET','/api/reports/v2/rows?report=sales'+range,undefined,{token});
    assert.equal(sales.status,200,JSON.stringify(sales));
    const saleSource=query("SELECT grand_total FROM sales WHERE invoice_id='"+paidInvoice+"'")[0];
    assert.equal(sales.rows.find(x=>x.sourceId===paidInvoice)?.amountMinor,
      Math.round(Number(saleSource.grand_total)*100),'sales register must match posted invoice, not mocked amount');
    const stock=await request('GET','/api/reports/v2/rows?report=stock'+range,undefined,{token});
    assert.equal(stock.status,200,JSON.stringify(stock));
    const stockSource=query("SELECT current_stock FROM products WHERE product_id='"+productId+"'")[0];
    assert.equal(stock.rows.find(x=>x.sourceId===productId)?.amountMinor,
      Math.round(Number(stockSource.current_stock)*Number(product.purchasePrice)*100),
      'stock value must reflect current lot remaining cost');
    const receivables=await request('GET','/api/reports/v2/rows?report=receivables'+range,undefined,{token});
    assert.equal(receivables.status,200,JSON.stringify(receivables));
    const dueSource=query("SELECT customer_id,current_due FROM customers WHERE phone='01000000777'")[0];
    assert.equal(receivables.rows.find(x=>x.sourceId===dueSource.customer_id)?.amountMinor,
      Math.round(Number(dueSource.current_due)*100),'dues must be sourced by immutable customer ID');
    const cash=await request('GET','/api/reports/v2/rows?report=cash'+range,undefined,{token});
    assert.equal(cash.status,200,JSON.stringify(cash));
    const cashSource=query("SELECT entry_id,credit FROM cash_book WHERE type='Sale' AND reference='"+paidInvoice+"'")[0];
    assert.equal(cash.rows.find(x=>x.sourceId===cashSource.entry_id)?.amountMinor,
      Math.round(Number(cashSource.credit)*100),'cash report must use exact money-book source ID');
    for(const report of ['expenses','finance']){
      const rows=await request('GET','/api/reports/v2/rows?report='+report+range,undefined,{token});
      assert.equal(rows.status,200,JSON.stringify(rows));
      assert.deepEqual(rows.rows,[],'an empty finance source is not sample data: '+report);
    }
    const summary=await request('GET','/api/reports/v2/summary?report=cash'+range,undefined,{token});
    assert.equal(summary.status,200,JSON.stringify(summary));
    assert.equal(summary.metrics.filter(x=>x.key==='operatingExpenses').length,1,
      'summary must have one authoritative operating expense');
    assert.equal(summary.metrics.find(x=>x.key==='receivablesBalance')?.valueMinor,
      Math.round(Number(dueSource.current_due)*100));
    const audit=await request('GET','/api/reports/v2/audit?'+range.slice(1),undefined,{token});
    assert.equal(audit.status,200);
    assert.equal(audit.readiness,'unavailable','Business Audit is explicitly deferred');
    assert.deepEqual(audit.sections,[]);
    assert.equal((await request('GET','/api/reports/v2/rows?report=sales&pageSize=200',undefined,{token})).status,400);
    assert.equal((await request('POST','/api/reports/v2/rows',{}, {token})).status,404);
    const reportAfter=query("SELECT (SELECT COUNT(*) FROM sales) sales,(SELECT COUNT(*) FROM cash_book) cash,(SELECT COUNT(*) FROM stock_lots) lots,(SELECT COUNT(*) FROM customer_ledger) ledger")[0];
    assert.deepEqual(reportAfter,reportBefore,'all report GETs must leave financial source tables untouched');
  });
  await check('concurrent identical requests cannot create two invoices',async()=>{
    const concurrent=sale('d1-ci-concurrent-key-003',1,'Cash',0,'01000000888');
    const res=await Promise.all(Array.from({length:3},()=>request('POST','/api/pos/sales',concurrent,{token})));
    assert.ok(res.every(x=>x.ok),JSON.stringify(res));
    assert.equal(new Set(res.map(x=>x.invoice.invoiceId)).size,1);
  });
  await check('oversell is rejected with no stock loss',async()=>{
    const r=await request('POST','/api/pos/sales',
      sale('d1-ci-oversell-key-004',99,'Cash',0,'01000000999'),{token});
    assert.equal(r.ok,false);
  });
  await check('real React browser signs in, reads D1 products, posts POS sale and fetches receipt',async()=>{
    // No API mocking. Uses Wrangler's real assets + Hono + this test D1.
    report.realBrowser=await runRealD1Browser();
    assert.equal(report.realBrowser.checks.length,13,'Include real D1 product lots, stock adjustments and status');
  });
  await check('independent simultaneous buyers cannot double-consume one FIFO unit',async()=>{
    for(let i=0;i<4;i++){
      const name='D1 Concurrency Unit '+i;
      const product=await request('POST','/api/products',{
        productName:name,category:'Electrical',unit:'Pcs',brand:'',
        barcode:'D1-RACE-'+i,purchasePrice:10,sellingPrice:20,
        currentStock:1,minimumStock:0,status:'Active',
        trackSerial:false,trackExpiry:false,trackWarranty:false
      },{token});
      assert.equal(product.ok,true,JSON.stringify(product));
      const raceSale=(buyer)=>({
        clientRequestId:'d1-race-'+i+'-buyer-'+buyer+'-2026',
        customerName:'Race Buyer '+buyer,customerPhone:'01000'+String(i).padStart(2,'0')+buyer+'111',
        discount:0,paymentType:'Cash',paidAmount:0,paymentMethod:'Cash',
        items:[{productId:product.productId,name,qty:1,unitPrice:20,fulfillmentMode:'own'}]
      });
      const attempts=await Promise.all(
        ['A','B'].map(buyer=>request('POST','/api/pos/sales',raceSale(buyer),{token}))
      );
      const success=attempts.filter(x=>x.ok);
      const rejected=attempts.filter(x=>!x.ok);
      assert.equal(success.length,1,'Two independent requests must not share one available stock unit: '+JSON.stringify(attempts));
      assert.equal(rejected.length,1);
      assert.ok([400,409].includes(rejected[0].status),'Unexpected checkout conflict status: '+rejected[0].status);
      const stock=await request('GET','/api/bootstrap',undefined,{token});
      assert.equal(Number(stock.products.find(x=>x.productId===product.productId)?.currentStock),0);
      report.requests.push({method:'ASSERT',path:'independent-race-'+i,status:'1 accepted, 1 rejected'});
    }
  });

  await check('two simultaneous dues on one customer retain correct running ledger',async()=>{
    const item=await request('POST','/api/products',{
      productName:'D1 Shared Ledger Item',brand:'',category:'Electrical',unit:'Pcs',
      barcode:'D1-DUE-CONCURRENT',purchasePrice:10,sellingPrice:30,
      currentStock:2,minimumStock:0,status:'Active',
      trackSerial:false,trackExpiry:false,trackWarranty:false
    },{token});
    assert.equal(item.ok,true,JSON.stringify(item));
    const dueSale=key=>({
      clientRequestId:'d1-customer-due-race-'+key+'-2026',
      customerName:'D1 Test Customer',customerPhone:'01000000777',
      paymentType:'Due',paidAmount:0,paymentMethod:'Cash',discount:0,
      items:[{productId:item.productId,name:'D1 Shared Ledger Item',qty:1,unitPrice:30,fulfillmentMode:'own'}]
    });
    const both=await Promise.all(['A','B'].map(key=>request('POST','/api/pos/sales',dueSale(key),{token})));
    assert.ok(both.every(x=>x.ok),JSON.stringify(both));
    assert.equal(new Set(both.map(x=>x.invoice.invoiceId)).size,2);
    const customer=await request('GET','/api/pos/bootstrap',undefined,{token});
    assert.equal(Number(customer.customers.find(x=>x.phone==='01000000777')?.currentDue),180);
  });

} catch(err){
  report.failed.push({name:'runner',message:String(err?.stack||err)});
} finally{
  if(worker){
    worker.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve=>worker.once('exit',resolve)),
      new Promise(resolve=>setTimeout(resolve,6000))
    ]);
    if(worker.exitCode===null)worker.kill('SIGKILL');
  }
  try{
    // Query after Worker shutdown to verify the saved SQL state, not just HTTP responses.
    const qty=query("SELECT current_stock AS stock FROM products WHERE product_id='"+productId+"'");
    const sales=query("SELECT COUNT(*) AS n FROM sales");
    const rows=query("SELECT SUM(quantity) AS units FROM sale_item_lots WHERE invoice_id='"+paidInvoice+"'");
    const cash=query("SELECT credit FROM cash_book WHERE type='Sale' AND reference='"+paidInvoice+"'");
    const customer=query("SELECT current_due AS due FROM customers WHERE phone='01000000777'");
    const ledger=query("SELECT debit AS due FROM customer_ledger WHERE reference='"+partialInvoice+"'");
    const requestKeys=query('SELECT COUNT(*) AS n FROM pos_sale_requests');
    const raceRows=query("SELECT product_id,current_stock FROM products WHERE product_name LIKE 'D1 Concurrency Unit %' ORDER BY product_name");
    const raceLots=query("SELECT product_id,remaining_quantity FROM stock_lots WHERE product_id IN (SELECT product_id FROM products WHERE product_name LIKE 'D1 Concurrency Unit %')");
    const raceDraws=query("SELECT product_id,SUM(quantity) AS total FROM sale_item_lots WHERE product_id IN (SELECT product_id FROM products WHERE product_name LIKE 'D1 Concurrency Unit %') GROUP BY product_id");
    const sharedDueLedger=query("SELECT balance FROM customer_ledger WHERE customer_id=(SELECT customer_id FROM customers WHERE phone='01000000777') ORDER BY rowid");
    const sharedDueStock=query("SELECT current_stock FROM products WHERE product_name='D1 Shared Ledger Item'");
    const sharedDueLot=query("SELECT remaining_quantity FROM stock_lots WHERE product_id=(SELECT product_id FROM products WHERE product_name='D1 Shared Ledger Item')");
    const browserSale=query("SELECT invoice_id,grand_total,paid_amount,due_amount FROM sales WHERE customer_phone='01000000123'");
    const browserLot=query("SELECT SUM(quantity) AS qty FROM sale_item_lots WHERE invoice_id=(SELECT invoice_id FROM sales WHERE customer_phone='01000000123')");
    const browserCash=query("SELECT credit FROM cash_book WHERE type='Sale' AND reference=(SELECT invoice_id FROM sales WHERE customer_phone='01000000123')");
    const browserDueSale=query("SELECT invoice_id,grand_total,paid_amount,due_amount,customer_id FROM sales WHERE customer_phone='01000000124'");
    const browserDueCustomer=query("SELECT customer_id,current_due FROM customers WHERE phone='01000000124'");
    const browserDueLedger=query("SELECT debit,balance FROM customer_ledger WHERE reference=(SELECT invoice_id FROM sales WHERE customer_phone='01000000124')");
    const browserDueCash=query("SELECT credit FROM cash_book WHERE type='Sale' AND reference=(SELECT invoice_id FROM sales WHERE customer_phone='01000000124')");
    const createdProduct=query("SELECT product_id,product_name,current_stock,purchase_price,selling_price FROM products WHERE product_name='D1 Browser Socket Updated'");
    const createdLots=query("SELECT remaining_quantity,unit_cost,source_type FROM stock_lots WHERE product_id=(SELECT product_id FROM products WHERE product_name='D1 Browser Socket Updated')");
    const adjustmentRows=query("SELECT movement_type,quantity_in,quantity_out,balance_after,note FROM stock_movements WHERE product_id=(SELECT product_id FROM products WHERE product_name='D1 Browser Socket Updated') AND note='Task 7 real cycle count' ORDER BY created_at,id");
    const audit={stock:qty[0]?.stock,sales:sales[0]?.n,paidSaleLotQty:rows[0]?.units,
      cashReceived:cash[0]?.credit,customerDue:customer[0]?.due,
      ledgerDue:ledger[0]?.due,requestKeys:requestKeys[0]?.n,
      browserInvoiceCount:browserSale.length,browserTotal:browserSale[0]?.grand_total,
      browserPaid:browserSale[0]?.paid_amount,browserDue:browserSale[0]?.due_amount,
      browserLotQty:browserLot[0]?.qty,browserCash:browserCash[0]?.credit,
      browserDueInvoiceCount:browserDueSale.length,
      browserDueTotal:browserDueSale[0]?.grand_total,browserDuePaid:browserDueSale[0]?.paid_amount,
      browserDueAmount:browserDueSale[0]?.due_amount,browserCustomerDue:browserDueCustomer[0]?.current_due,
      browserLedgerDebit:browserDueLedger[0]?.debit,browserLedgerBalance:browserDueLedger[0]?.balance,
      browserDueCash:browserDueCash[0]?.credit,
      createdProductCount:createdProduct.length,createdProductStock:createdProduct[0]?.current_stock,
      createdProductCost:createdProduct[0]?.purchase_price,createdProductSelling:createdProduct[0]?.selling_price,
      createdLotCount:createdLots.length,createdLotStock:createdLots.reduce((sum,l)=>sum+Number(l.remaining_quantity),0),
      createdLotCosts:createdLots.map(l=>l.unit_cost),adjustmentRows,
      raceProducts:raceRows.length,raceStocks:raceRows.map(x=>x.current_stock),
      raceLotBalances:raceLots.map(x=>x.remaining_quantity),raceDrawTotals:raceDraws.map(x=>x.total),
      sharedDueBalances:sharedDueLedger.map(x=>x.balance),
      sharedDueStock:sharedDueStock[0]?.current_stock,sharedDueLot:sharedDueLot[0]?.remaining_quantity};
    report.databaseAudit=audit;
    assert.equal(audit.stock,2);
    assert.equal(audit.sales,11);
    assert.equal(audit.paidSaleLotQty,2);
    assert.equal(audit.cashReceived,200);
    assert.equal(audit.customerDue,180);
    assert.equal(audit.ledgerDue,120);
    assert.equal(audit.requestKeys,11);
    assert.equal(audit.browserInvoiceCount,1);
    assert.equal(audit.browserTotal,100);
    assert.equal(audit.browserPaid,100);
    assert.equal(audit.browserDue,0);
    assert.equal(audit.browserLotQty,1);
    assert.equal(audit.browserCash,100);
    assert.equal(audit.browserDueInvoiceCount,1);
    assert.equal(audit.browserDueTotal,100);
    assert.equal(audit.browserDuePaid,40);
    assert.equal(audit.browserDueAmount,60);
    assert.equal(audit.browserCustomerDue,60);
    assert.equal(audit.browserLedgerDebit,60);
    assert.equal(audit.browserLedgerBalance,60);
    assert.equal(audit.browserDueCash,40);
    assert.equal(audit.createdProductCount,1);
    assert.equal(audit.createdProductStock,3);
    assert.equal(audit.createdProductCost,95);
    assert.equal(audit.createdProductSelling,175);
    assert.equal(audit.createdLotCount,2,'Opening FIFO lot plus one adjustment lot');
    assert.equal(audit.createdLotStock,3,'All FIFO lots reconcile with current stock');
    assert.deepEqual(audit.createdLotCosts,[95,95]);
    assert.equal(audit.adjustmentRows.length,2,'Both real browser stock adjustments are audited');
    assert.deepEqual(audit.adjustmentRows.map(m=>[m.movement_type,m.quantity_in,m.quantity_out]),[
      ['STOCK_IN_ADJUSTMENT',1,0],['STOCK_OUT_ADJUSTMENT',0,1]
    ]);
    assert.equal(audit.raceProducts,4);
    assert.deepEqual(audit.raceStocks,[0,0,0,0]);
    assert.deepEqual(audit.raceLotBalances,[0,0,0,0]);
    assert.deepEqual(audit.raceDrawTotals,[1,1,1,1]);
    assert.deepEqual(audit.sharedDueBalances,[120,150,180]);
    assert.equal(audit.sharedDueStock,0);
    assert.equal(audit.sharedDueLot,0);
    assert.equal(query("SELECT current_due FROM customers WHERE phone='01000000777'")[0]?.current_due,180);
    report.passed.push('D1 SQL reconciliation after Worker shutdown');
  }catch(e){report.failed.push({name:'D1 SQL reconciliation',message:String(e?.stack||e)});process.stderr.write('D1 SQL reconciliation failed: '+String(e?.stack||e)+'\n');}
  report.finishedAt=new Date().toISOString();
  writeFileSync(join(out,'d1-local-results.json'),JSON.stringify(report,null,2));
  // Never write setup tokens or full request bodies to artifacts.
  writeFileSync(join(out,'worker.log'),logs.replaceAll(setupSecret,'[redacted]').slice(-12000));
  rmSync(state,{recursive:true,force:true});
}
process.stdout.write('Local Worker+D1: '+report.passed.length+' passed; '+report.failed.length+' failed\n');
if(report.failed.length)process.exitCode=1;
