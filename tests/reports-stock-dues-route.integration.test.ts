import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('v2 stock/customer/supplier rows are authenticated, source-linked, read-only and dated as current snapshots',async()=>{
 const db=new SqliteDatabase(':memory:');
 try {
  runMigrations(db.native,resolve('migrations'));
  let token='';
  const api=async(method:string,path:string,body?:unknown)=>{
    const response=await handleApiRequest(new Request('https://local.test'+path,{
      method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    }),db);
    return {status:response.status,...await response.json() as Record<string,any>};
  };
  assert.equal((await api('GET','/api/reports/v2/rows?report=stock')).status,401);
  const setup=await api('POST','/api/setup/admin',{fullName:'Reporting Test',phone:'01000009223',password:'LocalTestOnly2026'});
  assert.equal(setup.status,200,JSON.stringify(setup));token=setup.token;
  db.native.prepare("INSERT INTO products(product_id,product_name,category,unit,current_stock) VALUES ('STK-API-1','Cable','Electrical','Pcs',2)").run();
  db.native.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,original_quantity,remaining_quantity,unit_cost) VALUES ('LOT-API-1','STK-API-1','PURCHASE',2,2,25)").run();
  db.native.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due) VALUES ('C-API-1','Buyer','01000000098',40)").run();
  db.native.prepare("INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,debit,credit,balance) VALUES ('CL-API-1','2026-10-26','C-API-1','Buyer','Opening Balance',40,0,40)").run();
  db.native.prepare("INSERT INTO suppliers(supplier_id,supplier_name,current_due) VALUES ('S-API-1','Supplier',70)").run();
  db.native.prepare("INSERT INTO supplier_ledger(ledger_id,date,supplier_id,supplier_name,type,debit,credit,balance) VALUES ('SL-API-1','2026-10-26','S-API-1','Supplier','Opening Balance',70,0,70)").run();
  const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  for(const [category,id,amount] of [['stock','STK-API-1',5000],['receivables','C-API-1',4000],['payables','S-API-1',7000]] as const){
    const res=await api('GET','/api/reports/v2/rows?report='+category+'&from=2026-10-01&to=2026-10-30');
    assert.equal(res.status,200,JSON.stringify(res));
    assert.equal(res.totalRows,1);
    assert.equal(res.rows[0].sourceId,id);
    assert.equal(res.rows[0].amountMinor,amount);
    assert.equal(res.coverage.status,'needs-review');
    assert.match(res.coverage.reason,/current.*snapshot/i);
    assert.equal(res.pageSize,50);
  }
  const denied=await api('POST','/api/reports/v2/rows?report=stock',{});
  assert.equal(denied.status,404);
  const after=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
  assert.equal(after,before,'report routes must not write');
 }finally{db.close();}
});
