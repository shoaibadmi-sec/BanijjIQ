import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 7F: inventory alerts require current Products.view permission, not Reports.view', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    async function api(method: string, path: string, body?:unknown, token='') {
      const response = await handleApiRequest(new Request('http://local.test'+path, {
        method,
        headers: {'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body),
      }),db);
      return {status:response.status,...await response.json() as Record<string,any>};
    }
    const endpoint='/api/products/stock-alerts?asOf=2026-10-30&days=7';
    assert.equal((await api('GET',endpoint)).status,401);
    const admin=await api('POST','/api/setup/admin',{
      fullName:'Inventory Admin',phone:'01000009901',password:'LocalTestOnly2026!'
    });
    assert.equal(admin.status,200,JSON.stringify(admin));
    const token=admin.token as string;
    db.native.prepare("INSERT INTO products (product_id,product_name,category,unit,current_stock,minimum_stock) VALUES ('R-P1','Sensitive Product','Hardware','Pcs',0,3)").run();
    const role=await api('POST','/api/roles',{
      name:'ReportsOnlyInventoryDeny',permissions:{reports:{view:true}}
    },token);
    assert.equal(role.status,200,JSON.stringify(role));
    const user=await api('POST','/api/users',{
      name:'Reports Only',mobile:'01000009902',role:'ReportsOnlyInventoryDeny',password:'LocalTestOnly2026!'
    },token);
    assert.equal(user.status,200,JSON.stringify(user));
    const staff=await api('POST','/api/auth/login',{
      phone:'01000009902',password:'LocalTestOnly2026!'
    });
    assert.equal(staff.status,200,JSON.stringify(staff));
    const before=db.native.prepare('SELECT total_changes() AS changes').get() as {changes:number};
    const denied=await api('GET',endpoint,undefined,staff.token);
    assert.equal(denied.status,403,JSON.stringify(denied));
    assert.equal(denied.alerts,undefined,'denied user cannot see product information');
    const adminResult=await api('GET',endpoint,undefined,token);
    assert.equal(adminResult.status,200,JSON.stringify(adminResult));
    assert.equal(adminResult.alerts[0].productId,'R-P1');
    const after=db.native.prepare('SELECT total_changes() AS changes').get() as {changes:number};
    assert.equal(after.changes,before.changes,'denied and successful reads cannot write inventory');
  } finally {
    db.close();
  }
});
