import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
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
    const before = (db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    const catalog = await call('GET','/api/reports/v2/catalog');
    assert.equal(catalog.status,200,JSON.stringify(catalog));
    assert.deepEqual(catalog.mainTabs.map((x:any)=>x.id),['overview','library']);
    assert.ok(!catalog.reports.some((x:any)=>x.id==='advisor'));
    const rows = await call('GET','/api/reports/v2/rows?report=sales&from=2026-10-01&to=2026-10-30');
    assert.equal(rows.status,200,JSON.stringify(rows));
    assert.equal(rows.totalRows,1);
    assert.deepEqual(rows.rows.map((x:any)=>x.sourceId),['INV-REPORT-001']);
    assert.equal(rows.rows[0].amountMinor,12000);
    assert.equal(rows.coverage.status,'needs-review');
    const invalid = await call('GET','/api/reports/v2/rows?report=sales&pageSize=500');
    assert.equal(invalid.status,400);
    const unsupported = await call('GET','/api/reports/v2/rows?report=profit');
    assert.equal(unsupported.status,200);
    assert.equal(unsupported.coverage.status,'unavailable');
    assert.deepEqual(unsupported.rows,[]);
    assert.equal((await call('POST','/api/reports/v2/rows',{})).status,404);
    const after = (db.native.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    assert.equal(after,before);
  } finally { db.close(); }
});
