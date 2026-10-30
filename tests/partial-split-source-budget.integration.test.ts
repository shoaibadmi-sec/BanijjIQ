import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

function fixture(){
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  const sql=db.native;
  sql.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('PART-C','Refund Buyer','01000008080',0,'Active',0)").run();
  for(const invoice of ['PART-SALE','PART-OTHER']){
    sql.prepare("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,discount,paid_amount,due_amount,payment_type,payment_status,payment_method,status,is_deleted) VALUES (?, '2026-10-30','PART-C','Refund Buyer','01000008080',50,50,0,50,0,'Cash','Paid','Split','Completed',0)").run(invoice);
    for(const [line,method,amount,key,customer] of [
      [1,'Cash',2000,'Cash',''],[2,'Store Credit',3000,'Store Credit','PART-C']
    ] as const){
      sql.prepare('INSERT INTO sale_tender_allocations(allocation_id,invoice_id,line_number,method,amount_cents,source_key,customer_id) VALUES (?,?,?,?,?,?,?)')
        .run(invoice+'-'+line,invoice,line,method,amount,key,customer);
    }
  }
  const returned=(id:string,amount:number,invoice='PART-SALE')=>{
    sql.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES (?,'2026-10-30',?,'PART-C','Refund Buyer','01000008080','Split Partial',?,'Original source refund test')")
      .run(id,invoice,amount/100);
  };
  const source=(id:string,method:string,amount:number,invoice='PART-SALE',
    customer=method==='Store Credit'?'PART-C':'',account='',key=method)=>{
    sql.prepare('INSERT INTO split_partial_refund_allocations(allocation_id,return_id,invoice_id,method,amount_cents,bank_account_id,customer_id,source_key) VALUES (?,?,?,?,?,?,?,?)')
      .run(id+'-'+invoice+'-'+key,id,invoice,method,amount,account,customer,key);
  };
  const count=()=>Number((sql.prepare('SELECT COUNT(*) n FROM split_partial_refund_allocations').get() as any).n);
  return {db,sql,returned,source,count};
}

test('G2-I cumulative original-source partial refund capacity is precise across three returns',()=>{
  const f=fixture();
  try{
    f.returned('PART-R1',1000);f.source('PART-R1','Cash',400);f.source('PART-R1','Store Credit',600);
    f.returned('PART-R2',1000);f.source('PART-R2','Cash',400);f.source('PART-R2','Store Credit',600);
    f.returned('PART-R3',3000);f.source('PART-R3','Cash',1200);f.source('PART-R3','Store Credit',1800);
    assert.equal(f.count(),6);
    assert.deepEqual(f.sql.prepare('SELECT source_key,SUM(amount_cents) n FROM split_partial_refund_allocations WHERE invoice_id=? GROUP BY source_key ORDER BY source_key').all('PART-SALE')
      .map((x:any)=>[x.source_key,x.n]),[['Cash',2000],['Store Credit',3000]]);
    f.returned('PART-EXTRA',100);
    assert.throws(()=>f.source('PART-EXTRA','Cash',100),/PARTIAL_SPLIT_SOURCE_CONFLICT/);
    assert.equal(f.count(),6,'an additional refund never consumes funds beyond original tenders');
  }finally{f.db.close();}
});

test('G2-I source ledger fails closed on replay, forged source, wrong invoice, and aggregate overdraw',()=>{
  const f=fixture();
  try{
    f.returned('PART-R1',1000);f.source('PART-R1','Cash',400);
    assert.throws(()=>f.source('PART-R1','Cash',400),/UNIQUE|constraint/i);
    assert.throws(()=>f.source('PART-R1','Store Credit',600,'PART-SALE','OTHER-C'),/PARTIAL_SPLIT_SOURCE_CONFLICT/);
    assert.throws(()=>f.source('PART-R1','Bank',100,'PART-SALE','','BANK-X','Bank:BANK-X'),/PARTIAL_SPLIT_SOURCE_CONFLICT/);
    assert.throws(()=>f.source('PART-R1','Cash',10,'PART-OTHER'),/PARTIAL_SPLIT_SOURCE_CONFLICT/);
    f.returned('PART-R2',1900);
    assert.throws(()=>f.source('PART-R2','Cash',1900),/PARTIAL_SPLIT_SOURCE_CONFLICT/);
    assert.equal(f.count(),1,'no invalid allocations committed');
  }finally{f.db.close();}
});

test('G2-I source allocation is append-only with no mutable accounting amount or deletion',()=>{
  const f=fixture();
  try{
    f.returned('PART-R1',1000);f.source('PART-R1','Cash',400);
    assert.throws(()=>f.sql.prepare('UPDATE split_partial_refund_allocations SET amount_cents=1').run(),/PARTIAL_SPLIT_APPEND_ONLY/);
    assert.throws(()=>f.sql.prepare('DELETE FROM split_partial_refund_allocations').run(),/PARTIAL_SPLIT_APPEND_ONLY/);
    assert.throws(()=>f.source('PART-R1','Cash',0),/CHECK|constraint/i);
    assert.equal(f.count(),1);
  }finally{f.db.close();}
});
