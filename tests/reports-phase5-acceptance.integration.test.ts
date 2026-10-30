import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

const reports=['sales','purchase','stock','receivables','payables','profit',
  'product-profit','profit-loss','cash','bank','finance','expenses','audit'] as const;
const unavailable=new Set(['product-profit','profit-loss','audit']);
const range='&from=2026-10-01&to=2026-10-30';
function fixture(){
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  return db;
}
async function api(db:SqliteDatabase,method:string,path:string,token='',body?:unknown){
  const response=await handleApiRequest(new Request('http://local.test'+path,{
    method,headers:{'content-type':'application/json',
      ...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  }),db);
  return {status:response.status,...await response.json() as Record<string,any>};
}
const changes=(db:SqliteDatabase)=>(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;

test('all Phase 5 report endpoints obey authentication, RBAC, status and read-only contracts',async()=>{
  const db=fixture();
  try {
    const paths=['/api/reports/v2/catalog','/api/reports/v2/summary?from=2026-10-01&to=2026-10-30',
      '/api/reports/v2/audit?from=2026-10-01&to=2026-10-30',
      ...reports.map(report=>'/api/reports/v2/rows?report='+report+range)];
    for(const path of paths)
      assert.equal((await api(db,'GET',path)).status,401,path+' must authenticate');

    const setup=await api(db,'POST','/api/setup/admin',
      '',{fullName:'Phase Five Admin',phone:'01000009872',password:'Phase5LocalTest2026'});
    assert.equal(setup.status,200,JSON.stringify(setup));
    const admin=String(setup.token);
    const restricted='phase5-restricted-session';
    const hash=createHash('sha256').update(restricted).digest('base64');
    db.native.prepare("INSERT INTO app_users (user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('phase5-staff','Reports Restricted','01000009873','fixture','fixture','report-restricted','Active','Fixture')").run();
    db.native.prepare("INSERT INTO auth_sessions (session_id,user_id,token_hash,expires_at) VALUES ('phase5-session','phase5-staff',?,datetime('now','+2 hours'))").run(hash);
    const before=changes(db);
    for(const path of paths)
      assert.equal((await api(db,'GET',path,restricted)).status,403,path+' requires reports.view');

    const catalog=await api(db,'GET',paths[0],admin);
    assert.equal(catalog.status,200);
    assert.deepEqual(catalog.mainTabs.map((x:any)=>x.id),['overview','library']);
    assert.deepEqual(catalog.reports.map((x:any)=>x.id),[...reports]);
    for(const report of reports) {
      const response=await api(db,'GET','/api/reports/v2/rows?report='+report+range,admin);
      assert.equal(response.status,200,report+': '+JSON.stringify(response));
      assert.equal(response.report,report);
      assert.equal(response.pageSize,50);
      assert.equal(response.page,1);
      assert.deepEqual(response.range,{from:'2026-10-01',to:'2026-10-30'});
      assert.ok(Array.isArray(response.rows));
      assert.ok(Array.isArray(response.metrics));
      assert.ok(['ready','needs-review','incomplete','unavailable'].includes(response.coverage.status));
      if(unavailable.has(report)) {
        assert.equal(response.coverage.status,'unavailable',report);
        assert.equal(response.totalRows,0);
        assert.deepEqual(response.metrics,[]);
        assert.deepEqual(response.rows,[]);
        assert.equal(catalog.reports.find((x:any)=>x.id===report)?.status,'unavailable');
      }
    }
    const summary=await api(db,'GET',paths[1],admin);
    assert.equal(summary.status,200);
    assert.ok(summary.metrics.some((m:any)=>m.key==='grossProfit'));
    assert.ok(summary.metrics.some((m:any)=>m.key==='inventoryValue'));
    assert.equal(summary.metrics.some((m:any)=>m.key==='productProfit'),false);
    const audit=await api(db,'GET',paths[2],admin);
    assert.equal(audit.status,200);
    assert.equal(audit.readiness,'unavailable');
    assert.deepEqual(audit.sections,[]);
    for(const path of [
      '/api/reports/v2/rows?report=unknown'+range,
      '/api/reports/v2/rows?report=sales&page=0',
      '/api/reports/v2/rows?report=stock&pageSize=75',
      '/api/reports/v2/rows?report=profit&from=2026-10-30&to=2026-10-01',
      '/api/reports/v2/summary?from=2026-02-30&to=2026-03-01',
      '/api/reports/v2/audit?from=2025-01-01&to=2026-10-30'
    ])assert.equal((await api(db,'GET',path,admin)).status,400,path);
    for(const path of ['/api/reports/v2/rows','/api/reports/v2/catalog',
      '/api/reports/v2/summary','/api/reports/v2/audit'])
      assert.equal((await api(db,'POST',path,admin,{})).status,404,path+' cannot accept writes');
    assert.equal(changes(db),before,'Phase 5 routes must never mutate accounting');
  } finally { db.close(); }
});

test('Phase 5 report rows retain real source IDs and summary cannot invent FIFO profit',async()=>{
  const db=fixture();
  try {
    const setup=await api(db,'POST','/api/setup/admin','',
      {fullName:'Reports Sources Admin',phone:'01000009874',password:'Phase5LocalTest2026'});
    assert.equal(setup.status,200);
    const token=String(setup.token);
    db.native.prepare("INSERT INTO sales(invoice_id,sale_date,customer_name,customer_phone,subtotal,discount,grand_total,payment_type,payment_status) VALUES ('P5-SALE','2026-10-15','Customer P5','01000009875',110,0,110,'Cash','Paid')").run();
    db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('P5-SKU','Wire','Electrical','Pcs',2)").run();
    db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('P5-LOT','P5-SKU','PURCHASE',2,2,25)").run();
    db.native.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due) VALUES ('P5-CUST','Customer P5','01000009875',40)").run();
    db.native.prepare("INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,debit,credit,balance) VALUES ('P5-CL','2026-10-15','P5-CUST','Customer P5','Opening Balance',40,0,40)").run();
    db.native.prepare("INSERT INTO suppliers(supplier_id,supplier_name,current_due) VALUES ('P5-SUP','Supplier P5',60)").run();
    db.native.prepare("INSERT INTO supplier_ledger(ledger_id,date,supplier_id,supplier_name,type,debit,credit,balance) VALUES ('P5-SL','2026-10-15','P5-SUP','Supplier P5','Opening Balance',60,0,60)").run();
    const before=changes(db);
    for(const [report,id,amount] of [
      ['sales','P5-SALE',11000],['stock','P5-SKU',5000],
      ['receivables','P5-CUST',4000],['payables','P5-SUP',6000]
    ] as const){
      const response=await api(db,'GET','/api/reports/v2/rows?report='+report+range,token);
      assert.equal(response.status,200);
      assert.equal(response.totalRows,1,report);
      assert.equal(response.rows[0].sourceId,id,report);
      assert.equal(response.rows[0].amountMinor,amount,report);
      assert.notEqual(response.rows[0].status,'ready','current snapshots/recorded sales are not certified history');
    }
    const profit=await api(db,'GET','/api/reports/v2/rows?report=profit'+range,token);
    assert.equal(profit.coverage.status,'incomplete','unallocated sale cannot certify margin');
    assert.equal(profit.metrics.find((x:any)=>x.key==='netSales').valueMinor,11000);
    assert.equal(profit.metrics.find((x:any)=>x.key==='fifoCogs').valueMinor,null);
    assert.equal(profit.metrics.find((x:any)=>x.key==='netProfit').valueMinor,null);
    const summary=await api(db,'GET','/api/reports/v2/summary?from=2026-10-01&to=2026-10-30',token);
    assert.equal(summary.status,200);
    assert.equal(summary.coverage.status,'incomplete');
    assert.equal(summary.metrics.find((x:any)=>x.key==='grossProfit').valueMinor,null);
    assert.equal(summary.metrics.find((x:any)=>x.key==='inventoryValue').valueMinor,5000);
    assert.equal(summary.metrics.find((x:any)=>x.key==='receivablesBalance').valueMinor,4000);
    assert.equal(summary.metrics.find((x:any)=>x.key==='payablesBalance').valueMinor,6000);
    assert.equal(changes(db),before);
  } finally { db.close(); }
});
