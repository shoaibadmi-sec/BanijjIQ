import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const mod=await import('../server/modules/sales/sale-tenders.ts').catch(()=>({} as any));
const validateTenderAllocation=(mod as any).validateTenderAllocation;

const accountContext={
  customer:{customerId:'C-1',status:'Active',isDeleted:false},
  availableStoreCreditCents:3500,legacyReviewRequired:false,
  bankAccounts:[
    {bankAccountId:'B-1',accountType:'Bank',status:'Active',isDeleted:false},
    {bankAccountId:'M-1',accountType:'Mobile Banking',status:'Active',isDeleted:false},
    {bankAccountId:'B-OFF',accountType:'Bank',status:'Inactive',isDeleted:false}
  ]
};
function validated(input:any,total=5000,customerId='C-1',context:any=accountContext){
  assert.equal(typeof validateTenderAllocation,'function',
    'G2-G payment allocation validator must exist before any POS split-payment posting');
  return validateTenderAllocation(input,total,customerId,context);
}

test('G2-G immutable split tender totals are integer poisha and sources remain separate',()=>{
  const a=validated({tenders:[
    {method:'Cash',amountCents:2000},
    {method:'Store Credit',amountCents:3000}
  ]});
  assert.equal(a.paidCents,5000);
  assert.equal(a.dueCents,0);
  assert.deepEqual(a.allocations.map((r:any)=>[r.method,r.amountCents,r.sourceKey]),[
    ['Cash',2000,'Cash'],['Store Credit',3000,'Store Credit']
  ]);
  assert.equal(Object.isFrozen(a),true);
  assert.equal(Object.isFrozen(a.allocations),true);
  assert.equal(Object.isFrozen(a.allocations[0]),true);

  const b=validated({tenders:[
    {method:'Bank',amountCents:1000,bankAccountId:'B-1'},
    {method:'Mobile Banking',amountCents:2000,bankAccountId:'M-1'},
    {method:'Store Credit',amountCents:2000}
  ]});
  assert.deepEqual(b.allocations.map((r:any)=>[r.sourceKey,r.amountCents]),[
    ['Bank:B-1',1000],['Mobile Banking:M-1',2000],['Store Credit',2000]
  ]);
  assert.equal(b.dueCents,0);
});

test('G2-G calculates remaining receivable only from the discounted invoice total',()=>{
  const a=validated({tenders:[
    {method:'Cash',amountCents:1200},
    {method:'Bank',amountCents:300,bankAccountId:'B-1'}
  ]},2000,'');
  assert.equal(a.paidCents,1500);
  assert.equal(a.dueCents,500);
  assert.equal(validated({tenders:[]},2000),null,
    'empty tender array keeps legacy single-tender POS processing unchanged');
  assert.equal(validated({},2000),null,
    'omitting tenders keeps legacy paymentType/paymentMethod behavior');
});

test('G2-G blocks overpayment, malformed poisha and duplicate source records',()=>{
  const invalid=[
    [{method:'Cash',amountCents:5001}],
    [{method:'Cash',amountCents:-1}],
    [{method:'Cash',amountCents:0}],
    [{method:'Cash',amountCents:NaN}],
    [{method:'Cash',amountCents:12.5}],
    [{method:'Cash',amountCents:Infinity}],
    [{method:'Cash',amountCents:1},{method:'Cash',amountCents:2}],
    [{method:'Bank',bankAccountId:'B-1',amountCents:1},{method:'Bank',bankAccountId:'B-1',amountCents:2}],
    [{method:'Store Credit',amountCents:4000}]
  ];
  for(const tenders of invalid){
    assert.throws(()=>validated({tenders}),undefined,
      'Invalid allocation must be rejected: '+JSON.stringify(tenders));
  }
  assert.throws(()=>validated({tenders:[{method:'Cash',amountCents:100}]},-1));
  assert.throws(()=>validated({tenders:[{method:'Cash',amountCents:100}]},5000.2));
  assert.throws(()=>validated({tenders:[{method:'Other',amountCents:100}]}));
});

test('G2-G requires account type, valid bank selection and active matching customer',()=>{
  const bank={method:'Bank',amountCents:2000};
  assert.throws(()=>validated({tenders:[bank]}));
  assert.throws(()=>validated({tenders:[{...bank,bankAccountId:'M-1'}]}));
  assert.throws(()=>validated({tenders:[{...bank,bankAccountId:'B-OFF'}]}));
  assert.throws(()=>validated({tenders:[{...bank,bankAccountId:'missing'}]}));
  assert.throws(()=>validated({tenders:[
    {method:'Cash',amountCents:100,bankAccountId:'B-1'}
  ]}));
  const credit={tenders:[{method:'Store Credit',amountCents:2000}]};
  assert.throws(()=>validated(credit,5000,''));
  assert.throws(()=>validated(credit,5000,'C-2'));
  assert.throws(()=>validated(credit,5000,'C-1',{...accountContext,customer:{...accountContext.customer,status:'Inactive'}}));
  assert.throws(()=>validated(credit,5000,'C-1',{...accountContext,customer:{...accountContext.customer,isDeleted:true}}));
  assert.throws(()=>validated(credit,5000,'C-1',{...accountContext,legacyReviewRequired:true}));
  assert.throws(()=>validated(credit,5000,'C-1',{...accountContext,availableStoreCreditCents:1500}));
});

test('G2-G tender journal migration is source-unique and append-only',()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    const sql=db.native;
    assert.ok(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_tender_allocations'").get());
    assert.ok(sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_sale_tender_no_update'").get());
    assert.ok(sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_sale_tender_no_delete'").get());
  }finally{db.close();}
});

test('G2-G refuses unlinked Store Credit in a split sale without changing any books',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    async function api(method:string,path:string,body?:unknown){
      const result=await handleApiRequest(new Request('http://split-guard.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:result.status,...await result.json() as any};
    }
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Split Tender Guard',phone:'01000009071',password:'SplitTenderTest2026Strong!'
    });
    assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
    assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
    const item=await api('POST','/api/products',{
      productName:'Guarded Cable',category:'Electrical',unit:'Pcs',
      purchasePrice:5,sellingPrice:10,currentStock:4,minimumStock:0,status:'Active'
    });
    assert.equal(item.ok,true,JSON.stringify(item));
    const row=(query:string)=>db.native.prepare(query).get() as any;
    const initial={
      invoices:row('SELECT COUNT(*) n FROM sales').n,
      cash:row('SELECT COUNT(*) n FROM cash_book').n,
      bank:row('SELECT COUNT(*) n FROM bank_book').n,
      journal:row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,
      tenders:row('SELECT COUNT(*) n FROM sale_tender_allocations').n
    };
    const response=await api('POST','/api/pos/sales',{
      clientRequestId:'split-task4-must-block-001',
      customerName:'Split Guard Customer',customerPhone:'01000009072',
      paymentType:'Cash',paymentMethod:'Cash',
      tenders:[{method:'Cash',amountCents:100},{method:'Store Credit',amountCents:900}],
      items:[{productId:item.productId,qty:1,unitPrice:10}]
    });
    assert.equal(response.status,409,JSON.stringify(response));
    assert.match(String(response.error),/Store Credit|customer/i);
    assert.equal(row('SELECT COUNT(*) n FROM sales').n,initial.invoices);
    assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,initial.cash);
    assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,initial.bank);
    assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,initial.journal);
    assert.equal(row('SELECT COUNT(*) n FROM sale_tender_allocations').n,initial.tenders);
    assert.equal(db.native.prepare('SELECT current_stock n FROM products WHERE product_id=?')
      .get(item.productId).n,4);
    assert.equal(row('SELECT COUNT(*) n FROM pos_sale_requests').n,0);
  }finally{db.close();}
});


for(const profile of ['cash-credit','bank-mobile-credit'] as const){
  test('G2-G atomic '+profile+' sale: exact independent books, rollback and replay',async()=>{
    const db=new SqliteDatabase(':memory:');
    try{
      runMigrations(db.native,resolve('migrations'));
      let token='';
      const api=async(method:string,path:string,body?:unknown)=>{
        const res=await handleApiRequest(new Request('http://split-atomic.test'+path,{
          method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
          body:body===undefined?undefined:JSON.stringify(body)
        }),db);
        return {status:res.status,...await res.json() as any};
      };
      const admin=await api('POST','/api/setup/admin',{
        fullName:'Split Atomic Tester',phone:profile==='cash-credit'?'01000007111':'01000007112',
        password:'SplitAtomicTest2026Strong!'
      });
      assert.equal(admin.ok,true,JSON.stringify(admin));token=admin.token;
      assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
      const customerId='SPLIT-CUS';
      db.native.prepare("INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) VALUES ('SPLIT-CUS','Split Buyer','01000007113',0,'Active',0)").run();
      // Verified old cash-funded return is the only source of the liability.
      db.native.prepare("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method) VALUES ('SPLIT-ORIG','2026-10-30','SPLIT-CUS','Split Buyer','01000007113',40,40,0,'Cash','Paid','Cash')").run();
      db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES ('SPLIT-ORIG-CASH','2026-10-30','Sale','SPLIT-ORIG','Original cash payment',0,40,'Cash',0)").run();
      db.native.prepare("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('SPLIT-ORIG','SPLIT-PROD','Wire',4,10,40)").run();
      db.native.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason) VALUES ('SPLIT-RETURN','2026-10-30','SPLIT-ORIG','SPLIT-CUS','Split Buyer','01000007113','Store Credit',30,'Store Credit liability source')").run();
      db.native.prepare("INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES ('SPLIT-RETURN','SPLIT-ORIG','SPLIT-PROD','Wire',3,10,30)").run();
      db.native.prepare("INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,created_by) VALUES ('SPLIT-ISSUE','SPLIT-CUS','ISSUE','Sales Return','SPLIT-RETURN',3000,3000,'tester')").run();
      const product=await api('POST','/api/products',{
        productName:'Split Cable',category:'Electrical',unit:'Pcs',purchasePrice:5,
        sellingPrice:10,currentStock:20,minimumStock:0,status:'Active'
      });
      assert.equal(product.ok,true,JSON.stringify(product));
      const bank=profile==='bank-mobile-credit'
        ?await api('POST','/api/bank/accounts',{name:'Split Bank',accountType:'Bank',openingBalance:100})
        :null;
      const mobile=profile==='bank-mobile-credit'
        ?await api('POST','/api/bank/accounts',{name:'Split Mobile',accountType:'Mobile Banking',openingBalance:100})
        :null;
      if(bank)assert.equal(bank.ok,true,JSON.stringify(bank));
      if(mobile)assert.equal(mobile.ok,true,JSON.stringify(mobile));
      const tenders=profile==='cash-credit'
        ?[{method:'Cash',amountCents:2000},{method:'Store Credit',amountCents:3000}]
        :[{method:'Bank',bankAccountId:bank.id,amountCents:1000},
          {method:'Mobile Banking',bankAccountId:mobile.id,amountCents:2000},
          {method:'Store Credit',amountCents:2000}];
      const sale={
        clientRequestId:'split-atomic-'+profile+'-2026',
        customerId,customerName:'Split Buyer',customerPhone:'01000007113',
        paymentType:'Cash',paymentMethod:'Cash',discount:0,tenders,
        items:[{productId:product.productId,qty:5,unitPrice:10}]
      };
      const row=(sql:string,...args:unknown[])=>db.native.prepare(sql).get(...args) as any;
      const baseline={
        invoices:row('SELECT COUNT(*) n FROM sales').n,
        credit:row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,
        cash:row('SELECT COUNT(*) n FROM cash_book').n,
        bank:row('SELECT COUNT(*) n FROM bank_book').n
      };
      db.native.exec("CREATE TRIGGER split_audit_fault BEFORE INSERT ON audit_logs WHEN NEW.action='CREATE_SALE' BEGIN SELECT RAISE(ABORT,'SPLIT_AUDIT_FAULT'); END");
      const fault=await api('POST','/api/pos/sales',sale);
      assert.equal(fault.ok,false,JSON.stringify(fault));
      assert.equal(row('SELECT COUNT(*) n FROM sales').n,baseline.invoices);
      assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,baseline.credit);
      assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,baseline.cash);
      assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,baseline.bank);
      assert.equal(row('SELECT COUNT(*) n FROM sale_tender_allocations').n,0);
      assert.equal(row('SELECT COUNT(*) n FROM pos_sale_requests').n,0);
      assert.equal(row('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,20);
      db.native.exec('DROP TRIGGER split_audit_fault');
      const good=await api('POST','/api/pos/sales',sale);
      assert.equal(good.ok,true,JSON.stringify(good));
      assert.equal(good.invoice.paidAmount,50);
      assert.equal(good.invoice.dueAmount,0);
      const saleId=good.invoice.invoiceId;
      const allocations=db.native.prepare('SELECT method,amount_cents,bank_account_id FROM sale_tender_allocations WHERE invoice_id=? ORDER BY line_number').all(saleId) as any[];
      assert.deepEqual(allocations.map(x=>x.amount_cents),tenders.map(x=>x.amountCents));
      assert.equal(row('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,15);
      assert.equal(row("SELECT SUM(delta_cents) n FROM customer_store_credit_entries WHERE customer_id='SPLIT-CUS'").n,
        profile==='cash-credit'?0:1000);
      assert.equal(row("SELECT COALESCE(SUM(credit),0) n FROM cash_book WHERE reference=?",saleId).n,
        profile==='cash-credit'?20:0);
      assert.equal(row("SELECT COALESCE(SUM(credit),0) n FROM bank_book WHERE reference=?",saleId).n,
        profile==='cash-credit'?0:30);
      if(bank){
        assert.equal(row('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bank.id).n,110);
        assert.equal(row('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',mobile.id).n,120);
      }
      const retry=await api('POST','/api/pos/sales',sale);
      assert.equal(retry.ok,true,JSON.stringify(retry));
      assert.equal(retry.invoice.invoiceId,saleId);
      assert.deepEqual(retry.invoice.paymentAllocations.map((t:any)=>t.amountCents),tenders.map(t=>t.amountCents));
      assert.equal((await api('POST','/api/pos/sales',{...sale,tenders:tenders.map((x,i)=>i?x:{...x,amountCents:x.amountCents-1})})).status,409);
      assert.equal(row('SELECT COUNT(*) n FROM sale_tender_allocations').n,tenders.length);
      const previewResponse=await api('GET','/api/sales-management/'+saleId+'/split-reversal');
      assert.equal(previewResponse.status,200,JSON.stringify(previewResponse));
      assert.equal(previewResponse.preview.eligible,true,JSON.stringify(previewResponse));
      assert.equal(previewResponse.preview.invoiceId,saleId);
      assert.equal(previewResponse.preview.totalCents,5000);
      assert.equal(previewResponse.preview.creditReissueCents,
        profile==='cash-credit'?3000:2000);
      assert.deepEqual(previewResponse.preview.allocations.map((a:any)=>
        [a.method,a.amountCents,a.bankAccountId||'']),
        tenders.map(t=>[t.method,t.amountCents,t.bankAccountId||'']));
      assert.equal(previewResponse.preview.refundCents,
        profile==='cash-credit'?2000:3000);
      // Full Phase 3 accounting acceptance: a preflight must NOT approve
      // an invoice whose immutable posting proof the POST would later reject.
      // This guards the entire UI "Confirm" workflow from misleading Cash payout.
      const snapshot=row('SELECT discount,subtotal FROM sales WHERE invoice_id=?',saleId);
      db.native.prepare('UPDATE sales SET discount=1 WHERE invoice_id=?').run(saleId);
      const discounted=await api('GET','/api/sales-management/'+saleId+'/split-reversal');
      assert.equal(discounted.preview.eligible,false,
        'discounted/mutated source must be rejected BEFORE confirming full refund');
      assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',saleId).n,0);
      db.native.prepare('UPDATE sales SET discount=?,subtotal=? WHERE invoice_id=?')
        .run(snapshot.discount,snapshot.subtotal,saleId);

      const item=row('SELECT id,unit_price FROM sale_items WHERE invoice_id=?',saleId);
      db.native.prepare('UPDATE sale_items SET unit_price=unit_price+1 WHERE id=?').run(item.id);
      const alteredPrice=await api('GET','/api/sales-management/'+saleId+'/split-reversal');
      assert.equal(alteredPrice.preview.eligible,false,
        'original line price mismatch must fail closed before refund approval');
      db.native.prepare('UPDATE sale_items SET unit_price=? WHERE id=?')
        .run(item.unit_price,item.id);
      assert.equal((await api('GET','/api/sales-management/'+saleId+'/split-reversal')).preview.eligible,true,
        'verified original source must remain eligible after fixture restoration');
      // An inactive original bank account must block refund rather than
      // redirecting funds to a different source or rewriting history.
      if(bank){
        db.native.prepare("UPDATE bank_accounts SET status='Inactive' WHERE bank_account_id=?").run(bank.id);
        const blocked=await api('GET','/api/sales-management/'+saleId+'/split-reversal');
        assert.equal(blocked.preview.eligible,false,JSON.stringify(blocked));
        db.native.prepare("UPDATE bank_accounts SET status='Active' WHERE bank_account_id=?").run(bank.id);
      }
      assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',saleId).n,0);
      // G2-H Task 2: a final audit fault must roll back FIFO restore,
      // all money-source refunds, credit reissue, and reversal idempotency.
      const before={
        returns:row('SELECT COUNT(*) n FROM sales_returns').n,
        cash:row('SELECT COUNT(*) n FROM cash_book').n,
        bank:row('SELECT COUNT(*) n FROM bank_book').n,
        credit:row('SELECT COUNT(*) n FROM customer_store_credit_entries').n
      };
      db.native.exec("CREATE TRIGGER split_refund_audit_fault BEFORE INSERT ON audit_logs WHEN NEW.action='REVERSE_SPLIT_SALE' BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_AUDIT_FAULT'); END");
      const url='/api/sales-management/'+saleId+'/split-reversal';
      const reversalBody={reason:'Refund exactly to verified original payment sources'};
      const failed=await api('POST',url,reversalBody);
      assert.equal(failed.ok,false,JSON.stringify(failed));
      assert.equal(row('SELECT COUNT(*) n FROM sales_returns').n,before.returns);
      assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
      assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,before.bank);
      assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,before.credit);
      assert.equal(row('SELECT COUNT(*) n FROM sales_return_refund_allocations').n,0);
      assert.equal(row('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,15);
      db.native.exec('DROP TRIGGER split_refund_audit_fault');
      // A silent 0-row lot restoration is not an exception. The final D1
      // audit must detect it and abort all refund sources and credit ISSUE.
      db.native.exec("CREATE TRIGGER split_skip_fifo_restoration BEFORE UPDATE ON stock_lots WHEN NEW.remaining_quantity>OLD.remaining_quantity BEGIN SELECT RAISE(IGNORE); END");
      const missed=await api('POST',url,reversalBody);
      assert.equal(missed.status,409,JSON.stringify(missed));
      assert.equal(row('SELECT COUNT(*) n FROM sales_returns').n,before.returns);
      assert.equal(row('SELECT COUNT(*) n FROM cash_book').n,before.cash);
      assert.equal(row('SELECT COUNT(*) n FROM bank_book').n,before.bank);
      assert.equal(row('SELECT COUNT(*) n FROM customer_store_credit_entries').n,before.credit);
      assert.equal(row('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,15);
      db.native.exec('DROP TRIGGER split_skip_fifo_restoration');
      const reversed=await api('POST',url,reversalBody);
      assert.equal(reversed.ok,true,JSON.stringify(reversed));
      assert.equal(reversed.refundCents,profile==='cash-credit'?2000:3000);
      assert.equal(reversed.creditReissueCents,profile==='cash-credit'?3000:2000);
      const returnId=reversed.returnId;
      assert.equal(row('SELECT status s FROM sales WHERE invoice_id=?',saleId).s,'Reversed');
      assert.equal(row('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,20);
      assert.equal(row('SELECT COUNT(*) n FROM sale_reversal_logs WHERE invoice_id=?',saleId).n,1);
      assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',saleId).n,1);
      assert.deepEqual((db.native.prepare(
        'SELECT method,amount_cents,bank_account_id FROM sales_return_refund_allocations WHERE return_id=? ORDER BY line_number'
      ).all(returnId) as any[]).map(x=>[x.method,x.amount_cents,x.bank_account_id||'']),
        tenders.map(x=>[x.method,x.amountCents,x.bankAccountId||'']));
      assert.equal(row("SELECT COALESCE(SUM(debit),0) n FROM cash_book WHERE reference=? AND type='Sales Return'",returnId).n,
        profile==='cash-credit'?20:0);
      assert.equal(row("SELECT COALESCE(SUM(debit),0) n FROM bank_book WHERE reference=? AND type='Sales Return'",returnId).n,
        profile==='cash-credit'?0:30);
      if(bank){
        assert.equal(row('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',bank.id).n,100);
        assert.equal(row('SELECT current_balance n FROM bank_accounts WHERE bank_account_id=?',mobile.id).n,100);
      }
      assert.equal(row(
        "SELECT COALESCE(SUM(delta_cents),0) n FROM customer_store_credit_entries WHERE entry_type='ISSUE' AND source_type='Sales Return' AND source_id=?",returnId
      ).n,profile==='cash-credit'?3000:2000);
      assert.equal(row(
        "SELECT COALESCE(SUM(delta_cents),0) n FROM customer_store_credit_entries WHERE customer_id='SPLIT-CUS'"
      ).n,3000);
      const again=await api('POST',url,reversalBody);
      assert.equal(again.status,409,JSON.stringify(again));
      assert.equal(row('SELECT COUNT(*) n FROM sales_returns WHERE invoice_id=?',saleId).n,1);
      assert.equal(row('SELECT COUNT(*) n FROM sales_return_refund_allocations WHERE return_id=?',returnId).n,tenders.length);
      // Legacy single-source return/edit/delete remain blocked even after reversal.
      assert.equal((await api('POST','/api/sales-returns',{
        invoiceId:saleId,refundMethod:'Cash',reason:'Cannot refund source multiple times',
        items:[{productId:product.productId,qty:1,unitPrice:10}]
      })).status,409);
      assert.equal((await api('PUT','/api/sales-management/'+saleId,{
        reason:'Changing historical tender sources is unsafe',
        customerName:'Split Buyer',customerPhone:'01000007113',
        items:[{productId:product.productId,qty:5,unitPrice:10}]
      })).status,409);
      assert.equal((await api('DELETE','/api/sales-management/'+saleId,{
        reason:'Unreconciled split tender cannot be deleted'
      })).status,409);
      assert.equal(row('SELECT current_stock n FROM products WHERE product_id=?',product.productId).n,20);
    }finally{db.close();}
  });
}
