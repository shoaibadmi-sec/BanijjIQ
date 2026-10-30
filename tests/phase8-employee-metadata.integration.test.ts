import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 8 stores employee email and true joining date, without inferring from account creation', async () => {
  const db = new SqliteDatabase(':memory:');
  const call = async (method:string, path:string, token='', body?:unknown) => {
    const res = await handleApiRequest(new Request('http://test.local'+path,{
      method, headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    }),db);
    return {...await res.json() as Record<string,any>,status:res.status};
  };
  try {
    runMigrations(db.native,resolve('migrations'));
    const owner = await call('POST','/api/setup/admin','',{
      fullName:'Test Owner',phone:'01000008101',password:'TestPasswordPhase8!'
    });
    assert.equal(owner.status,200);
    const token=owner.token as string;
    const list=()=>call('GET','/api/users',token);
    const original=(await list()).users.find((u:any)=>u.id===owner.user.userId);
    assert.equal(original.email,null,'no fictional legacy email');
    assert.equal(original.joinedDate,null,'createdAt cannot stand in for joined date');
    const role=await call('POST','/api/roles',token,{name:'StockReader',permissions:{products:{view:true}}});
    assert.equal(role.status,200);
    const created=await call('POST','/api/users',token,{
      name:'Stock Keeper',mobile:'01000008102',role:'StockReader',password:'TestStaffPhase8!',
      email:'  KEEPER@Example.com  ',joinedDate:'2024-02-29'
    });
    assert.equal(created.status,200,JSON.stringify(created));
    let row=(await list()).users.find((u:any)=>u.id===created.id);
    assert.equal(row.email,'keeper@example.com');
    assert.equal(row.joinedDate,'2024-02-29');
    const edit=await call('PUT','/api/users/'+created.id,token,{
      name:'Updated Stock Keeper',mobile:'01000008102',role:'StockReader',
      email:'newkeeper@example.com',joinedDate:'2025-01-31'
    });
    assert.equal(edit.status,200,JSON.stringify(edit));
    row=(await list()).users.find((u:any)=>u.id===created.id);
    assert.equal(row.email,'newkeeper@example.com');
    assert.equal(row.joinedDate,'2025-01-31');
    const bad=await call('PUT','/api/users/'+created.id,token,{
      name:'Must Not Save',mobile:'01000008102',role:'StockReader',
      email:'bad-address',joinedDate:'2025-02-30'
    });
    assert.equal(bad.status,400);
    row=(await list()).users.find((u:any)=>u.id===created.id);
    assert.equal(row.name,'Updated Stock Keeper');
    assert.equal(row.email,'newkeeper@example.com');
    assert.equal(row.joinedDate,'2025-01-31');
    const legacyEdit=await call('PUT','/api/users/'+created.id,token,{
      name:'Stock Keeper Again',mobile:'01000008102',role:'StockReader'
    });
    assert.equal(legacyEdit.status,200);
    row=(await list()).users.find((u:any)=>u.id===created.id);
    assert.equal(row.email,'newkeeper@example.com','omitting metadata must preserve saved values');
    assert.equal(row.joinedDate,'2025-01-31');
  } finally { db.close(); }
});
