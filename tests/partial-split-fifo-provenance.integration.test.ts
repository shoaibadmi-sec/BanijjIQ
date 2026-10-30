import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

/** Real full-migration SQLite; no mocks and no financial posting endpoint. */
function fixture(){
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  const q=db.native;
  q.prepare("INSERT INTO customers(customer_id,customer_name,phone,status,is_deleted) VALUES ('FIFO-C','FIFO Buyer','01000008901','Active',0)").run();
  for(const [invoice,product,lot,sold] of [
    ['FIFO-A','FIFO-PA','FIFO-LA',5],['FIFO-B','FIFO-PB','FIFO-LB',1]
  ] as const){
    q.prepare("INSERT INTO products(product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status) VALUES (?,?,'Electrical','Pcs',5,10,10,'Active')").run(product,product);
    q.prepare("INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'OPENING','Opening stock',10,?,5,'Active')").run(lot,product,10-sold);
    q.prepare("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,subtotal,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method,status) VALUES (?,'2026-10-30','FIFO-C','FIFO Buyer','01000008901',?,?,?,0,'Cash','Paid','Split','Completed')").run(invoice,sold*10,sold*10,sold*10);
    q.prepare("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES (?,?,?,?,10,?)").run(invoice,product,product,sold,sold*10);
    q.prepare("INSERT INTO sale_item_lots(invoice_id,product_id,lot_id,quantity,unit_cost) VALUES (?,?,?,?,5)").run(invoice,product,lot,sold);
  }
  const startReturn=(id:string,invoice='FIFO-A',product='FIFO-PA',qty=2)=>{
    q.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES (?,'2026-10-30',?,'FIFO-C','FIFO Buyer','01000008901','Split Partial',?,'Partial FIFO provenance test')").run(id,invoice,qty*10);
    q.prepare('INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES (?,?,?,?,?,10,?)').run(id,invoice,product,product,qty,qty*10);
  };
  const evidence=(id:string,invoice='FIFO-A',product='FIFO-PA',lot='FIFO-LA',qty=2)=>
    q.prepare('INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,?,?,?,?)')
      .run(id,invoice,product,lot,qty);
  const n=()=>Number((q.prepare('SELECT COUNT(*) n FROM sales_return_item_lots').get() as any).n);
  return {db,q,startReturn,evidence,n};
}

test('G2-J partial FIFO provenance only admits return rows from the same invoice and sold lot',()=>{
  const f=fixture();
  try{
    f.startReturn('FIFO-R1');
    // The original invoice B has a real sold lot. The refund R1 belongs to
    // invoice A; a forged B allocation must not pass just because B sold it.
    assert.throws(()=>f.evidence('FIFO-R1','FIFO-B','FIFO-PB','FIFO-LB',1),
      /SPLIT_PARTIAL_FIFO_PROVENANCE_CONFLICT/,
      'Return invoice and original sold lot invoice must be identical');
    assert.equal(f.n(),0);
    f.evidence('FIFO-R1');
    assert.equal(f.n(),1);
  }finally{f.db.close();}
});

test('G2-J partial FIFO evidence cannot restore more than the selected return line',()=>{
  const f=fixture();
  try{
    f.startReturn('FIFO-R1');
    assert.throws(()=>f.evidence('FIFO-R1','FIFO-A','FIFO-PA','FIFO-LA',3),
      /SPLIT_PARTIAL_FIFO_PROVENANCE_CONFLICT/,
      'Source sale has 5 sold units but this return explicitly selected only 2');
    assert.equal(f.n(),0);
    f.evidence('FIFO-R1');
    assert.throws(()=>f.q.prepare('UPDATE sales_return_item_lots SET quantity=1').run(),
      /SPLIT_PARTIAL_FIFO_APPEND_ONLY/);
    assert.throws(()=>f.q.prepare('DELETE FROM sales_return_item_lots').run(),
      /SPLIT_PARTIAL_FIFO_APPEND_ONLY/);
    assert.equal(f.n(),1);
  }finally{f.db.close();}
});

test('G2-J successive partial FIFO returns cannot exceed original sold quantity',()=>{
  const f=fixture();
  try{
    f.startReturn('FIFO-R1','FIFO-A','FIFO-PA',2);
    f.evidence('FIFO-R1');
    f.startReturn('FIFO-R2','FIFO-A','FIFO-PA',3);
    f.evidence('FIFO-R2','FIFO-A','FIFO-PA','FIFO-LA',3);
    // Existing sales_return_items capacity guard rejects the third
    // quantity BEFORE any FIFO evidence is written. Preserve that guard.
    assert.throws(()=>f.startReturn('FIFO-R3','FIFO-A','FIFO-PA',1),
      /SALES_RETURN_QUANTITY_CONFLICT/);
    assert.equal(f.n(),2);
    assert.equal((f.q.prepare('SELECT SUM(quantity) n FROM sales_return_item_lots WHERE invoice_id=?').get('FIFO-A') as any).n,5);
  }finally{f.db.close();}
});

test('G2-J rejects tracked or oversold lots without writing FIFO evidence',()=>{
  const f=fixture();
  try{
    f.startReturn('FIFO-R1');
    f.q.prepare("UPDATE products SET track_serial=1 WHERE product_id='FIFO-PA'").run();
    assert.throws(()=>f.evidence('FIFO-R1'),/SPLIT_PARTIAL_FIFO_PROVENANCE_CONFLICT/);
    f.q.prepare("UPDATE products SET track_serial=0 WHERE product_id='FIFO-PA'").run();
    f.q.prepare("UPDATE stock_lots SET source_type='OVERSOLD' WHERE lot_id='FIFO-LA'").run();
    assert.throws(()=>f.evidence('FIFO-R1'),/SPLIT_PARTIAL_FIFO_PROVENANCE_CONFLICT/);
    assert.equal(f.n(),0);
  }finally{f.db.close();}
});

test('G2-J forged FIFO evidence rolls back the whole money and inventory batch',async()=>{
  const f=fixture();
  try{
    f.startReturn('FIFO-R1');
    const stock=Number((f.q.prepare("SELECT current_stock n FROM products WHERE product_id='FIFO-PA'").get() as any).n);
    const cash=Number((f.q.prepare("SELECT COUNT(*) n FROM cash_book").get() as any).n);
    await assert.rejects(
      f.db.batch([
        f.db.prepare("UPDATE products SET current_stock=current_stock+2 WHERE product_id='FIFO-PA'"),
        f.db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('FIFO-ROLLBACK-CASH','2026-10-30','Sales Return','FIFO-R1','Provisional refund',20,0,'Cash',0)"),
        f.db.prepare("INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES ('FIFO-R1','FIFO-B','FIFO-PB','FIFO-LB',1)")
      ]),/SPLIT_PARTIAL_FIFO_PROVENANCE_CONFLICT/
    );
    assert.equal((f.q.prepare("SELECT current_stock n FROM products WHERE product_id='FIFO-PA'").get() as any).n,stock);
    assert.equal((f.q.prepare('SELECT COUNT(*) n FROM cash_book').get() as any).n,cash);
    assert.equal(f.n(),0,'partial-amount journal cannot be attached to a forged FIFO restoration');
  }finally{f.db.close();}
});
