import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('G2-F verified-outstanding impact is read-only and requires exact original economic proof',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(method:string,path:string,body?:unknown,auth=true)=>{
      const response=await handleApiRequest(new Request('http://credit-impact.test'+path,{
        method,headers:{'content-type':'application/json',...(auth&&token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as any};
    };
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Impact Reviewer',phone:'01000008771',password:'ImpactReview2026Strong!'
    });
    assert.equal(setup.ok,true,JSON.stringify(setup));
    token=setup.token;
    const sql=db.native.prepare.bind(db.native);
    sql("INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) "+
      "VALUES ('IMPACT-CUS','Impact Customer','01000008772',-10,'Active',0)").run();
    sql("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,"+
      "grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) "+
      "VALUES ('IMPACT-SALE','2026-10-30','IMPACT-CUS','Impact Customer','01000008772',"+
      "50,50,0,'Cash','Paid','Cash')").run();
    sql("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('IMPACT-CASH','2026-10-30','Sale','IMPACT-SALE','Paid original',0,50,'Cash',0)").run();
    sql("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) "+
      "VALUES ('IMPACT-SALE','IMPACT-PROD','Switch',5,10,50)").run();
    sql("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,"+
      "refund_method,total_return_amount,reason) "+
      "VALUES ('IMPACT-RETURN','2026-10-30','IMPACT-SALE','IMPACT-CUS','Impact Customer','01000008772',"+
      "'Store Credit',10,'Old due-side credit')").run();
    sql("INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) "+
      "VALUES ('IMPACT-RETURN','IMPACT-SALE','IMPACT-PROD','Switch',1,10,10)").run();
    sql("INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) "+
      "VALUES ('IMPACT-LEDGER','2026-10-30','IMPACT-CUS','Impact Customer','Sales Return Credit',"+
      "'IMPACT-RETURN',0,10,-10,'Legacy offset')").run();

    const all=await api('GET','/api/pos/store-credit/reconciliation/cases');
    const review=all.cases.find((c:any)=>c.flagCode==='LEGACY_UNJOURNALED_RETURN');
    assert.ok(review,JSON.stringify(all));
    const path='/api/pos/store-credit/reconciliation/cases/'+encodeURIComponent(review.caseId)+'/impact';
    assert.equal((await api('GET',path,undefined,false)).status,401);
    const initial=await api('GET',path);
    assert.equal(initial.ok,true,JSON.stringify(initial));
    assert.equal(initial.readOnly,true);
    assert.equal(initial.eligible,true,JSON.stringify(initial));
    assert.equal(initial.caseId,review.caseId);
    assert.deepEqual(initial.blockingReasons,[]);
    assert.deepEqual(initial.impact,{
      receivableDeltaCents:1000,
      liabilityDeltaCents:1000,
      cashDeltaCents:0,
      bankDeltaCents:0
    });
    assert.deepEqual(initial.sourceIds,[
      'sale:IMPACT-SALE','return:IMPACT-RETURN','ledger:IMPACT-LEDGER','cash:IMPACT-CASH'
    ]);
    assert.equal((await api('POST',path,{})).status,404);
    assert.equal((await api('GET',path.replace('/impact','/nonexistent/impact'))).status,404);
    const count=(table:string)=>Number((db.native.prepare('SELECT COUNT(*) n FROM '+table).get() as any).n);
    assert.equal(count('store_credit_reconciliation_cases'),0);
    assert.equal(count('customer_store_credit_entries'),0);
    assert.equal(count('cash_book'),1);

    sql("UPDATE customers SET current_due=0 WHERE customer_id='IMPACT-CUS'").run();
    const noNegative=await api('GET',path);
    assert.equal(noNegative.eligible,false);
    assert.ok(noNegative.blockingReasons.includes('RECEIVABLE_NOT_EXACT_NEGATIVE_OFFSET'));
    sql("UPDATE customers SET current_due=-10 WHERE customer_id='IMPACT-CUS'").run();

    sql("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
      "VALUES ('IMPACT-REFUND','2026-10-30','Sales Return','IMPACT-RETURN','Already paid out',10,0,'Cash',0)").run();
    const paid=await api('GET',path);
    assert.equal(paid.eligible,false);
    assert.ok(paid.blockingReasons.includes('RETURN_ALREADY_REFUNDED'));
    sql("DELETE FROM cash_book WHERE entry_id='IMPACT-REFUND'").run();

    sql("INSERT INTO customer_ledger(ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) "+
      "VALUES ('IMPACT-LEDGER-2','2026-10-30','IMPACT-CUS','Impact Customer','Sales Return Credit',"+
      "'IMPACT-RETURN',0,2,-12,'Duplicate offset')").run();
    const duplicate=await api('GET',path);
    assert.equal(duplicate.eligible,false);
    assert.ok(duplicate.blockingReasons.includes('LEGACY_OFFSET_NOT_UNIQUE'));
    sql("DELETE FROM customer_ledger WHERE ledger_id='IMPACT-LEDGER-2'").run();
    sql("UPDATE sales_return_items SET line_total=9 WHERE return_id='IMPACT-RETURN'").run();
    const tampered=await api('GET',path);
    assert.equal(tampered.eligible,false);
    assert.ok(tampered.blockingReasons.includes('RETURN_ITEMS_MISMATCH'));
    sql("UPDATE sales_return_items SET line_total=10 WHERE return_id='IMPACT-RETURN'").run();
    const restored=await api('GET',path);
    assert.equal(restored.eligible,true,JSON.stringify(restored));
    assert.equal(count('store_credit_reconciliation_cases'),0);
    assert.equal(count('customer_store_credit_entries'),0);
    assert.equal((db.native.prepare("SELECT current_due FROM customers WHERE customer_id='IMPACT-CUS'").get() as any).current_due,-10);
  }finally{db.close();}
});
