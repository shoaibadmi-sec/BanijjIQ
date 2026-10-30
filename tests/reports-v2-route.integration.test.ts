import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('report v2 is read-only with real SQLite and auth', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    const migration = runMigrations(db.native, resolve('migrations'));
    assert.ok(migration.applied.length > 20);
    let token = '';
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await handleApiRequest(new Request('http://local.test' + path, {
        method, headers: {'content-type':'application/json', ...(token ? {authorization:'Bearer '+token} : {})},
        body: body === undefined ? undefined : JSON.stringify(body),
      }), db);
      return {status:response.status, ...await response.json() as Record<string, any>};
    };
    assert.equal((await call('GET','/api/reports/v2/catalog')).status,401);
    const setup = await call('POST','/api/setup/admin',{fullName:'Report Test Admin',phone:'01000008765',password:'LocalTestingPass2026'});
    assert.equal(setup.status,200);
    token = setup.token as string;
    db.native.prepare("INSERT INTO sales (invoice_id,sale_date,customer_name,customer_phone,grand_total,payment_type,payment_status) VALUES ('INV-REPORT-001','2026-10-15','Test Buyer','01000000121',120,'Cash','Paid')").run();
    db.native.prepare("INSERT INTO sales (invoice_id,sale_date,customer_name,customer_phone,grand_total,payment_type,payment_status,status) VALUES ('INV-DRAFT-UNPOSTED','2026-10-17','Unposted Buyer','01000000125',900,'Cash','Unpaid','Draft')").run();
    // A valid session for a non-admin without reports.view must not bypass the route guard.
    const adminToken=token;
    const deniedToken='local-staff-report-session-token';
    const tokenHash=createHash('sha256').update(deniedToken).digest('base64');
    db.native.prepare("INSERT INTO app_users (user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('report-restricted-user','Restricted User','01000008766','placeholder','placeholder','restricted-reports','Active','Fixture')").run();
    db.native.prepare("INSERT INTO auth_sessions (session_id,user_id,token_hash,expires_at) VALUES ('report-restricted-session','report-restricted-user',?,datetime('now','+2 hours'))").run(tokenHash);
    token=deniedToken;
    assert.equal((await call('GET','/api/reports/v2/rows?report=sales')).status,403);
    assert.equal((await call('GET','/api/reports/v2/catalog')).status,403);
    token=adminToken;
    const before = (db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    const catalog = await call('GET','/api/reports/v2/catalog');
    assert.equal(catalog.status,200,JSON.stringify(catalog));
    assert.deepEqual(catalog.mainTabs.map((x:any)=>x.id),['overview','library']);
    assert.ok(!catalog.reports.some((x:any)=>x.id==='advisor'));
    const rows = await call('GET','/api/reports/v2/rows?report=sales&from=2026-10-01&to=2026-10-30');
    assert.equal(rows.status,200,JSON.stringify(rows));
    assert.equal(rows.totalRows,1);
    assert.ok(!rows.rows.some((x:any)=>x.sourceId==='INV-DRAFT-UNPOSTED'), 'unposted invoices cannot appear in Sales Register');
    assert.deepEqual(rows.rows.map((x:any)=>x.sourceId),['INV-REPORT-001']);
    assert.equal(rows.rows[0].amountMinor,12000);
    assert.equal(rows.coverage.status,'needs-review');
    const invalid = await call('GET','/api/reports/v2/rows?report=sales&pageSize=500');
    assert.equal(invalid.status,400);
    const uncosted = await call('GET','/api/reports/v2/rows?report=profit&from=2026-10-01&to=2026-10-30');
    assert.equal(uncosted.status,200);
    assert.equal(uncosted.coverage.status,'incomplete','no sale item or original FIFO data is certified');
    assert.equal(uncosted.metrics.find((m:any)=>m.key==='netProfit')?.valueMinor,null);
    const summary = await call('GET','/api/reports/v2/summary?from=2026-10-01&to=2026-10-30');
    assert.equal(summary.status,200);
    assert.equal(summary.metrics.find((m:any)=>m.key==='grossProfit')?.valueMinor,null);
    const unsupported = await call('GET','/api/reports/v2/rows?report=audit');
    assert.equal(unsupported.status,200);
    assert.equal(unsupported.coverage.status,'unavailable');
    assert.deepEqual(unsupported.rows,[]);
    assert.equal((await call('POST','/api/reports/v2/rows',{})).status,404);
    const after = (db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    assert.equal(after,before);
    // Long-report acceptance: real posted invoices, deterministic page membership and no read-side writes.
    const insert=db.native.prepare("INSERT INTO sales (invoice_id,sale_date,customer_name,customer_phone,grand_total,payment_type,payment_status) VALUES (?,?,?,?,?,'Cash','Paid')");
    for(let i=1;i<=105;i++)
      insert.run('INV-CI-PAGE-'+String(i).padStart(4,'0'),'2026-10-15',
        'Pagination Test Buyer','01000000121',i);
    const pageBefore=(db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    const base='/api/reports/v2/rows?report=sales&from=2026-10-01&to=2026-10-30&search=CI-PAGE&sort=reference&direction=asc';
    const pages=[];
    for(const n of [1,2,3]) {
      const data=await call('GET',base+'&page='+n+'&pageSize=50');
      assert.equal(data.status,200,JSON.stringify(data));
      assert.equal(data.totalRows,105);
      pages.push(data.rows as Array<{sourceId:string}>);
    }
    assert.deepEqual(pages.map(x=>x.length),[50,50,5]);
    const allIds=pages.flat().map(x=>x.sourceId);
    assert.equal(new Set(allIds).size,105,'each posted invoice must appear exactly once');
    assert.deepEqual([allIds[0],allIds[49],allIds[50],allIds[104]],
      ['INV-CI-PAGE-0001','INV-CI-PAGE-0050','INV-CI-PAGE-0051','INV-CI-PAGE-0105']);
    const wide=await call('GET',base+'&page=2&pageSize=100');
    assert.equal(wide.totalRows,105);
    assert.deepEqual(wide.rows.map((x:{sourceId:string})=>x.sourceId),allIds.slice(100));
    const filtered=await call('GET','/api/reports/v2/rows?report=sales&search=INV-CI-PAGE-0105');
    assert.equal(filtered.totalRows,1);
    assert.equal(filtered.rows[0].sourceId,'INV-CI-PAGE-0105');
    assert.equal((await call('GET',base+'&page=0')).status,400);
    assert.equal((await call('GET',base+'&pageSize=75')).status,400);
    const pageAfter=(db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    assert.equal(pageAfter,pageBefore,'report pagination and filtering cannot mutate posted accounting sources');
  } finally { db.close(); }
});
