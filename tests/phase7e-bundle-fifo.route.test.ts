import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 7E: read-only Products.view permission allows FIFO preflight but not product writes',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(method:string,path:string,body?:unknown,bearer=token)=>{
   const r=await handleApiRequest(new Request('http://local.test'+path,{method,
    headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:r.status,...await r.json() as Record<string,any>};
  };
  const setup=await api('POST','/api/setup/admin',{fullName:'Bundle Role Admin',phone:'01000007773',password:'BundleRoleAdmin2026!'});
  assert.equal(setup.status,200,JSON.stringify(setup));token=setup.token;
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock,status) VALUES ('B-RBAC','Read stock','Hardware','Pcs',1,'Active')").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('B-RBAC-L','B-RBAC','PURCHASE',1,1,40)").run();
  const role=await api('POST','/api/roles',{name:'Bundle Stock Reader',permissions:{products:{view:true,add:false,edit:false,delete:'disabled'}}});
  assert.equal(role.status,200,JSON.stringify(role));
  const user=await api('POST','/api/users',{name:'Read Only Bundle',mobile:'01000007774',role:'Bundle Stock Reader',password:'BundleRoleRead2026!'});
  assert.equal(user.status,200,JSON.stringify(user));
  const login=await api('POST','/api/auth/login',{phone:'01000007774',password:'BundleRoleRead2026!'});
  assert.equal(login.status,200,JSON.stringify(login));
  const payload={sets:1,components:[{productId:'B-RBAC',quantityPerSet:1}]};
  const before=(db.native.prepare('SELECT total_changes() n').get() as any).n;
  const result=await api('POST','/api/products/bundle-fifo-preview',payload,login.token);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.totalCostMinor,4000);
  assert.equal((db.native.prepare('SELECT total_changes() n').get() as any).n,before);
  assert.equal((await api('POST','/api/products',{productName:'Invalid Create'},login.token)).status,403);
  assert.equal((await api('GET','/api/products/B-RBAC/history',undefined,login.token)).status,200);
 }finally{db.close();}
});
