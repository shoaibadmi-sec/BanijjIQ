import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('real Hono accounting routes on a fresh disposable database', async t => {
  const db=new SqliteDatabase(':memory:');
  try {
    const summary=runMigrations(db.native,resolve('migrations'));
    assert.ok(summary.applied.length>=20,'must apply complete schema, not an oversimplified fixture');
    let token='';
    async function api(method:string,path:string,body?:unknown){
      const headers:Record<string,string>={'content-type':'application/json'};
      if(token)headers.authorization='Bearer '+token;
      const request=new Request('http://local.test'+path,{
        method,headers,body:body===undefined?undefined:JSON.stringify(body)
      });
      const response=await handleApiRequest(request,db);
      const result=await response.json() as any;
      return {status:response.status,...result};
    }
    const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
    const all=(sql:string,...args:unknown[])=>db.native.prepare(sql).all(...args) as any[];
    const count=(table:string)=>Number(row('SELECT count(*) n FROM '+table).n);

    await t.test('authentication and a new admin session',async()=>{
      const unauth=await api('GET','/api/pos/bootstrap');
      assert.equal(unauth.status,401);
      const setup=await api('POST','/api/setup/admin',{
        fullName:'Isolated Test Admin',phone:'01000000111',password:'LocalOnlySecret2026!'
      });
      assert.equal(setup.ok,true,JSON.stringify(setup));
      assert.ok(setup.token);
      token=setup.token;
      assert.equal((await api('GET','/api/auth/me')).user.fullName,'Isolated Test Admin');
    });

    let productId='';
    await t.test('product create writes real opening FIFO lot',async()=>{
      const created=await api('POST','/api/products',{
        productName:'E2E Copper Cable',brand:'E2E Brand',category:'Electrical',unit:'Pcs',
        barcode:'E2E-001',purchasePrice:60,sellingPrice:100,currentStock:5,
        minimumStock:2,trackSerial:false,trackExpiry:false,trackWarranty:false,
        status:'Active'
      });
      assert.equal(created.ok,true,JSON.stringify(created));
      productId=created.productId;
      assert.equal(Number(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock),5);
      const lots=all('SELECT lot_id,remaining_quantity,unit_cost FROM stock_lots WHERE product_id=? ORDER BY id',productId);
      assert.equal(lots.length,1);
      assert.equal(lots[0].remaining_quantity,5);
      assert.equal(lots[0].unit_cost,60);
      // Simulate a later purchased lot, independently of product-opening-stock logic.
      db.native.prepare("INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'PURCHASE','E2E-PURCHASE',4,4,80,'Active')")
        .run('E2E-LOT-LATER',productId);
      db.native.prepare('UPDATE products SET current_stock=9 WHERE product_id=?').run(productId);
    });

    await t.test('cash session opens once and rejects duplicate open',async()=>{
      const opened=await api('POST','/api/pos/cash-session/start',{openingCash:500});
      assert.equal(opened.ok,true,JSON.stringify(opened));
      assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:500})).ok,false);
      assert.equal(count('cash_sessions'),1);
    });

    const item=(qty:number)=>({
      productId,name:'E2E Copper Cable',qty,unitPrice:100,fulfillmentMode:'own'
    });
    const cashSale={
      clientRequestId:'e2e-cash-sale-request-00001',
      customerName:'Paid Buyer',customerPhone:'01000000222',discount:0,
      paymentType:'Cash',paidAmount:0,paymentMethod:'Cash',items:[item(6)]
    };
    let paidInvoice='';
    await t.test('cash sale posts invoice, cash and FIFO lot allocations once',async()=>{
      const sale=await api('POST','/api/pos/sales',cashSale);
      assert.equal(sale.ok,true,JSON.stringify(sale));
      paidInvoice=sale.invoice.invoiceId;
      assert.equal(sale.invoice.grandTotal,600);
      assert.equal(sale.invoice.paidAmount,600);
      assert.equal(sale.invoice.dueAmount,0);
      assert.equal(Number(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock),3);
      const drawn=all('SELECT lot_id,quantity,unit_cost FROM sale_item_lots WHERE invoice_id=? ORDER BY id',paidInvoice);
      assert.deepEqual(drawn.map(x=>[x.quantity,x.unit_cost]),[[5,60],[1,80]]);
      assert.equal(Number(row("SELECT remaining_quantity FROM stock_lots WHERE lot_id='E2E-LOT-LATER'").remaining_quantity),3);
      assert.equal(row("SELECT SUM(credit) credit FROM cash_book WHERE type='Sale' AND reference=?",paidInvoice).credit,600);
      assert.equal(row('SELECT COUNT(*) n FROM customers WHERE phone=?','01000000222').n,0,
        'fully paid cash sale must not create a ledger customer');
      const invoice=await api('GET','/api/pos/invoices/'+paidInvoice);
      assert.equal(invoice.invoice.invoiceId,paidInvoice);
      assert.equal(invoice.invoice.items[0].quantity,6);
    });

    await t.test('retry of same request returns original invoice without side effects',async()=>{
      const before={
        sales:count('sales'),lots:all('SELECT lot_id,remaining_quantity FROM stock_lots WHERE product_id=? ORDER BY id',productId),
        cash:count('cash_book'),moves:count('stock_movements')
      };
      const replay=await api('POST','/api/pos/sales',cashSale);
      assert.equal(replay.ok,true,JSON.stringify(replay));
      assert.equal(replay.invoice.invoiceId,paidInvoice);
      assert.equal(count('sales'),before.sales);
      assert.equal(count('cash_book'),before.cash);
      assert.equal(count('stock_movements'),before.moves);
      assert.deepEqual(all('SELECT lot_id,remaining_quantity FROM stock_lots WHERE product_id=? ORDER BY id',productId),before.lots);
      const mismatch=await api('POST','/api/pos/sales',{...cashSale,items:[item(2)]});
      assert.equal(mismatch.status,409);
    });

    await t.test('partial payment creates customer due and reconciles ledger',async()=>{
      const sale=await api('POST','/api/pos/sales',{
        clientRequestId:'e2e-partial-request-00002',customerName:'Credit Buyer',
        customerPhone:'01000000333',discount:0,paymentType:'Partial',
        paidAmount:80,paymentMethod:'Cash',items:[item(2)]
      });
      assert.equal(sale.ok,true,JSON.stringify(sale));
      assert.equal(sale.invoice.grandTotal,200);
      assert.equal(sale.invoice.paidAmount,80);
      assert.equal(sale.invoice.dueAmount,120);
      const customer=row('SELECT customer_id,current_due FROM customers WHERE phone=?','01000000333');
      assert.ok(customer.customer_id);
      assert.equal(customer.current_due,120);
      assert.equal(row('SELECT debit,balance FROM customer_ledger WHERE reference=?',sale.invoice.invoiceId).debit,120);
      assert.equal(row('SELECT credit FROM cash_book WHERE type=? AND reference=?','Sale',sale.invoice.invoiceId).credit,80);
      assert.equal(row('SELECT current_stock FROM products WHERE product_id=?',productId).current_stock,1);
    });

    await t.test('oversell and invalid payment reject without mutations',async()=>{
      const prev={sales:count('sales'),moves:count('stock_movements'),customers:count('customers'),
        cash:count('cash_book'),stock:row('SELECT current_stock stock FROM products WHERE product_id=?',productId).stock};
      const over=await api('POST','/api/pos/sales',{
        clientRequestId:'e2e-oversell-request-00003',customerName:'Oversell',
        customerPhone:'01000000444',discount:0,paymentType:'Due',paidAmount:0,
        items:[item(99)]
      });
      assert.equal(over.ok,false);
      const invalid=await api('POST','/api/pos/sales',{
        clientRequestId:'e2e-bad-partial-0000004',customerName:'Invalid',
        customerPhone:'01000000555',discount:0,paymentType:'Partial',
        paidAmount:100,items:[item(1)]
      });
      assert.equal(invalid.ok,false);
      assert.equal(count('sales'),prev.sales);
      assert.equal(count('stock_movements'),prev.moves);
      assert.equal(count('customers'),prev.customers);
      assert.equal(count('cash_book'),prev.cash);
      assert.equal(row('SELECT current_stock stock FROM products WHERE product_id=?',productId).stock,prev.stock);
    });

    await t.test('forced SQL error rolls back customer, invoice, inventory and idempotency key',async()=>{
      db.native.exec("CREATE TRIGGER e2e_reject_sale BEFORE INSERT ON sale_items BEGIN SELECT RAISE(ABORT, 'forced sale failure'); END;");
      const before={customers:count('customers'),sales:count('sales'),
        stock:row('SELECT current_stock stock FROM products WHERE product_id=?',productId).stock,
        lots:all('SELECT remaining_quantity FROM stock_lots WHERE product_id=? ORDER BY id',productId)};
      const failed=await api('POST','/api/pos/sales',{
        clientRequestId:'e2e-failed-batch-request-05',customerName:'Never Saved',
        customerPhone:'01000000666',discount:0,paymentType:'Due',paidAmount:0,
        items:[item(1)]
      });
      assert.equal(failed.ok,false);
      assert.equal(count('customers'),before.customers);
      assert.equal(count('sales'),before.sales);
      assert.equal(row('SELECT current_stock stock FROM products WHERE product_id=?',productId).stock,before.stock);
      assert.deepEqual(all('SELECT remaining_quantity FROM stock_lots WHERE product_id=? ORDER BY id',productId),before.lots);
      assert.equal(row('SELECT count(*) n FROM pos_sale_requests WHERE request_id=?','e2e-failed-batch-request-05').n,0);
      db.native.exec('DROP TRIGGER e2e_reject_sale');
    });

    await t.test('atomic FIFO decrements prevent independent request overselling',async()=>{
      const newProduct=await api('POST','/api/products',{
        productName:'Contended Unit',brand:'',category:'Electrical',unit:'Pcs',
        barcode:'E2E-RACE-001',purchasePrice:10,sellingPrice:20,currentStock:1,
        minimumStock:0,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false
      });
      assert.equal(newProduct.ok,true);
      const sell=(buyer:string)=>({
        clientRequestId:'e2e-independent-race-'+buyer+'-2026',
        customerName:'Race '+buyer,customerPhone:'0100011'+buyer,
        paymentType:'Cash',paidAmount:0,paymentMethod:'Cash',discount:0,
        items:[{productId:newProduct.productId,name:'Contended Unit',qty:1,unitPrice:20,fulfillmentMode:'own'}]
      });
      const result=await Promise.all(['A','B'].map(x=>api('POST','/api/pos/sales',sell(x))));
      assert.equal(result.filter(x=>x.ok).length,1,JSON.stringify(result));
      assert.equal(result.filter(x=>!x.ok).length,1);
      assert.equal(row('SELECT current_stock stock FROM products WHERE product_id=?',newProduct.productId).stock,0);
      assert.equal(row('SELECT remaining_quantity n FROM stock_lots WHERE product_id=?',newProduct.productId).n,0);
      assert.equal(row('SELECT SUM(quantity) n FROM sale_item_lots WHERE product_id=?',newProduct.productId).n,1);
      assert.throws(()=>db.native.prepare('UPDATE stock_lots SET remaining_quantity=-1 WHERE product_id=?')
        .run(newProduct.productId),/POS_STOCK_CONFLICT/);
    });

    await t.test('concurrent dues update customer and ledger balances atomically',async()=>{
      const newProduct=await api('POST','/api/products',{
        productName:'Ledger Race Unit',brand:'',category:'Electrical',unit:'Pcs',
        barcode:'E2E-DUE-RACE',purchasePrice:10,sellingPrice:30,currentStock:2,
        minimumStock:0,status:'Active',trackSerial:false,trackExpiry:false,trackWarranty:false
      });
      assert.equal(newProduct.ok,true);
      const due=(key:string)=>({
        clientRequestId:'e2e-shared-ledger-'+key+'-2026',
        customerName:'Credit Buyer',customerPhone:'01000000333',
        paymentType:'Due',paidAmount:0,discount:0,
        items:[{productId:newProduct.productId,name:'Ledger Race Unit',qty:1,unitPrice:30,fulfillmentMode:'own'}]
      });
      const sales=await Promise.all(['A','B'].map(x=>api('POST','/api/pos/sales',due(x))));
      assert.ok(sales.every(x=>x.ok),JSON.stringify(sales));
      assert.equal(row('SELECT current_due due FROM customers WHERE phone=?','01000000333').due,180);
      const ledgers=all("SELECT balance FROM customer_ledger WHERE customer_id=(SELECT customer_id FROM customers WHERE phone='01000000333') ORDER BY rowid");
      assert.deepEqual(ledgers.map(x=>x.balance),[120,150,180]);
      assert.equal(row('SELECT current_stock stock FROM products WHERE product_id=?',newProduct.productId).stock,0);
      assert.equal(row('SELECT remaining_quantity n FROM stock_lots WHERE product_id=?',newProduct.productId).n,0);
    });
  } finally {
    db.close();
  }
});
