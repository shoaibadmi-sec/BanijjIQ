import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {buildDemoSeedPlan,executeDemoSeed} from '../scripts/preview/demo-seed-plan.mjs';

test('source-derived fixture preserves coherent quantity and due calculations',()=>{
 const plan=buildDemoSeedPlan();
 assert.equal(plan.products.length,13);
 assert.equal(plan.customers.length,4);
 assert.equal(plan.sales.length,2);
 assert.equal(plan.purchases.length,1);
 assert.equal(plan.products.find(p=>p.sourceId==='p3')?.openingStock,660);
 assert.equal(plan.products.find(p=>p.sourceId==='p9')?.openingStock,84);
 assert.ok(plan.excluded.some(s=>s.includes('historical dashboard')));
 assert.ok(plan.excluded.some(s=>s.includes('tracked serial')));
});

test('preview fixture posts real FIFO, supplier and customer dues, cash and expense, then refuses nonempty DB',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(method:string,path:string,body?:unknown)=>{
   const headers:Record<string,string>={'content-type':'application/json'};
   if(token)headers.authorization='Bearer '+token;
   const res=await handleApiRequest(new Request('https://isolated.local'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:res.status,...await res.json() as Record<string,any>};
  };
  const admin=await api('POST','/api/setup/admin',{
   fullName:'Fixture Admin',phone:'01000009123',password:'test-only-password-not-a-secret'
  });
  assert.equal(admin.status,200,JSON.stringify(admin));token=admin.token;
  const plan=buildDemoSeedPlan();
  const imported=await executeDemoSeed(api,plan);
  assert.equal(imported.products,13);
  assert.equal(imported.sales,2);
  assert.equal(imported.purchases,1);
  const one=(query:string,...args:any[])=>db.native.prepare(query).get(...args) as any;
  assert.equal(one('SELECT COUNT(*) n FROM products').n,13);
  assert.equal(one('SELECT COUNT(*) n FROM sales').n,2);
  assert.equal(one('SELECT COUNT(*) n FROM purchases').n,1);
  assert.equal(one('SELECT current_stock n FROM products WHERE product_name=?','MS Angle 1.5" × 1.5"').n,1240);
  assert.equal(one('SELECT current_stock n FROM products WHERE product_name=?','Teflon Tape').n,30);
  assert.equal(one('SELECT current_due n FROM customers WHERE customer_name=?','Rahman Hardware').n,25550);
  assert.equal(one('SELECT current_due n FROM suppliers WHERE supplier_name=?','Bismillah Steel House').n,38400);
  assert.equal(one("SELECT COUNT(*) n FROM cash_book WHERE type='Sale'").n,1);
  assert.equal(one('SELECT COUNT(*) n FROM expenses WHERE is_deleted=0').n,1);
  await assert.rejects(()=>executeDemoSeed(api,plan),/non-empty|already contains/i);
  assert.equal(one('SELECT COUNT(*) n FROM sales').n,2);
 }finally{db.close();}
});