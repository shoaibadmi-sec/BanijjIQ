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

test('G2-G rejects unimplemented split checkout before invoice, receipt or FIFO posting',async()=>{
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
    assert.match(String(response.error),/split|tender|allocation/i);
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
