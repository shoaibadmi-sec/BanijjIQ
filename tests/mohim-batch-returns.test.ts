import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.js';
import { runMigrations } from '../server/db/migrate.js';
import { completeSalesReturnBatchRoute, getCustomerReturnInvoices, searchReturnCustomers } from '../server/modules/sales/batchReturns.service.js';

const user={userId:'USR-1',fullName:'Cashier',phone:'',role:'admin',status:'Active'};
function fixture() {
  const db=new SqliteDatabase(':memory:');
  const migration=runMigrations(db.native,resolve('migrations'));
  assert.equal(migration.applied.length,30);
  db.native.prepare('INSERT INTO app_users (user_id,full_name,phone,password_hash,password_salt) VALUES (?,?,?,?,?)')
    .run(user.userId,user.fullName,'01700009999','hash','salt');
  db.native.prepare("INSERT INTO cash_sessions (session_id,opened_by,opening_cash,status) VALUES (?,?,0,'Open')").run('CS-1',user.userId);
  db.native.prepare("INSERT INTO customers (customer_id,customer_name,phone,current_due) VALUES (?,?,?,?)").run('CUS-1','Test Customer','01700000001',150);
  db.native.prepare('INSERT INTO products (product_id,product_name,category,unit,purchase_price,selling_price,current_stock) VALUES (?,?,?,?,?,?,?)').run('P-1','Elbow','Pipes','Pcs',10,15,80);
  db.native.prepare("INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?, 'PURCHASE',?,100,80,10,'Active')").run('LOT-1','P-1','PO-1');
  const date=new Date().toISOString().slice(0,10);
  for(const id of ['INV-1','INV-2']){
    db.native.prepare("INSERT INTO sales (invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,paid_amount,due_amount,payment_type,payment_status) VALUES (?,?,?,?,?,150,150,100,50,'Partial','Partial')")
      .run(id,date,'CUS-1','Test Customer','01700000001');
    db.native.prepare('INSERT INTO sale_items (invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)')
      .run(id,'P-1','Elbow',10,15,150);
    db.native.prepare('INSERT INTO sale_item_lots (invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id) VALUES (?,?,?,?,?,?)')
      .run(id,'P-1','LOT-1',10,10,'');
  }
  return {db,date};
}

test('batch return rejects wrong customer, duplicate invoice, invalid second line atomically', async () => {
  const {db,date}=fixture();
  try {
    const search=await (await searchReturnCustomers(db,new URL('https://erp.test/api/sales-returns/customers/search?q=Test'))).json() as any;
    assert.equal(search.customers.length,1);
    const invoices=await (await getCustomerReturnInvoices(db,'CUS-1')).json() as any;
    assert.equal(invoices.invoices.length,2);
    const base={customerId:'CUS-1',refundMethod:'Cash' as const,reason:'Test return',date};
    const wrong=await completeSalesReturnBatchRoute(db,{...base,customerId:'UNKNOWN',invoices:[
      {invoiceId:'INV-1',items:[{productId:'P-1',qty:1}]},
      {invoiceId:'INV-2',items:[{productId:'P-1',qty:1}]}
    ]},user);
    assert.equal(wrong.status,400);
    const duplicate=await completeSalesReturnBatchRoute(db,{...base,invoices:[
      {invoiceId:'INV-1',items:[{productId:'P-1',qty:1}]},
      {invoiceId:'INV-1',items:[{productId:'P-1',qty:1}]}
    ]},user);
    assert.equal(duplicate.status,400);
    const badLine=await completeSalesReturnBatchRoute(db,{...base,invoices:[
      {invoiceId:'INV-1',items:[{productId:'P-1',qty:2}]},
      {invoiceId:'INV-2',items:[{productId:'P-1',qty:11}]}
    ]},user);
    assert.equal(badLine.status,400);
    const cashLimit=await completeSalesReturnBatchRoute(db,{...base,invoices:[
      {invoiceId:'INV-1',items:[{productId:'P-1',qty:7}]},
      {invoiceId:'INV-2',items:[{productId:'P-1',qty:1}]}
    ]},user);
    assert.equal(cashLimit.status,400,'First invoice cash refund cannot use money collected against second');
    assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
    assert.equal((db.native.prepare('SELECT current_stock n FROM products WHERE product_id=?').get('P-1') as any).n,80);
  } finally {db.close();}
});

test('batch return posts two invoice-specific child returns atomically with exact lot restoration', async () => {
  const {db,date}=fixture();
  try{
    const response=await completeSalesReturnBatchRoute(db,{
      customerId:'CUS-1',refundMethod:'Store Credit',reason:'Customer returned elbows',date,
      invoices:[
        {invoiceId:'INV-1',items:[{productId:'P-1',qty:2,unitPrice:10}]},
        {invoiceId:'INV-2',items:[{productId:'P-1',qty:3,unitPrice:15}]}
      ]
    },user);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const data=await response.json() as any;
    assert.equal(data.returns.length,2);
    assert.notEqual(data.returns[0].returnId,data.returns[1].returnId);
    assert.equal(data.totalReturnAmount,65);
    const returns=db.native.prepare('SELECT batch_id,invoice_id,total_return_amount FROM sales_returns ORDER BY invoice_id').all() as any[];
    assert.deepEqual(returns.map(x=>x.batch_id),[data.batchId,data.batchId]);
    assert.deepEqual(returns.map(x=>x.invoice_id),['INV-1','INV-2']);
    assert.deepEqual(returns.map(x=>x.total_return_amount),[20,45]);
    assert.equal((db.native.prepare('SELECT current_stock n FROM products WHERE product_id=?').get('P-1') as any).n,85);
    assert.equal((db.native.prepare('SELECT remaining_quantity n FROM stock_lots WHERE lot_id=?').get('LOT-1') as any).n,85);
    assert.equal((db.native.prepare('SELECT current_due n FROM customers WHERE customer_id=?').get('CUS-1') as any).n,85);
    assert.equal((db.native.prepare("SELECT COUNT(*) n FROM customer_ledger WHERE type='Sales Return Credit'").get() as any).n,2);
    assert.equal((db.native.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE_SALES_RETURN'").get() as any).n,2);
    assert.deepEqual(db.native.pragma('foreign_key_check'),[]);
  } finally{db.close();}
});
