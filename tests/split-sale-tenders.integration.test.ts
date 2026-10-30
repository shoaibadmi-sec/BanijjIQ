import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('G2-G split tender cannot silently post its whole amount as legacy Cash before allocation posting is ready',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    const api=async(method:string,path:string,body?:unknown)=>{
      const res=await handleApiRequest(new Request('http://split.test'+path,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:res.status,...await res.json() as any};
    };
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Split Tender Reviewer',phone:'01000008702',password:'SplitTenderStrong2026!'
    });
    assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
    const p=await api('POST','/api/products',{
      productName:'Split Safety Cable',category:'Electrical',unit:'Pcs',
      purchasePrice:20,sellingPrice:50,currentStock:5,minimumStock:0,status:'Active'
    });
    assert.equal(p.ok,true,JSON.stringify(p));
    assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
    const before=(table:string)=>Number((db.native.prepare('SELECT COUNT(*) n FROM '+table).get() as any).n);
    const old={sales:before('sales'),cash:before('cash_book'),
      bank:before('bank_book'),journal:before('customer_store_credit_entries')};
    const partial=await api('POST','/api/pos/sales',{
      clientRequestId:'split-guard-0001',customerName:'Split Buyer',customerPhone:'01000008703',
      paymentType:'Cash',paidAmount:50,paymentMethod:'Cash',
      items:[{productId:p.productId,name:'Split Safety Cable',qty:1,unitPrice:50}],
      tenders:[{method:'Cash',amountCents:2000},{method:'Store Credit',amountCents:3000}]
    });
    assert.equal(partial.status,409,JSON.stringify(partial));
    assert.match(String(partial.error),/split tender|allocation/i);
    assert.equal(before('sales'),old.sales);
    assert.equal(before('cash_book'),old.cash);
    assert.equal(before('bank_book'),old.bank);
    assert.equal(before('customer_store_credit_entries'),old.journal);
    const normal=await api('POST','/api/pos/sales',{
      clientRequestId:'single-tender-guard-0002',customerName:'Ordinary Buyer',customerPhone:'01000008704',
      paymentType:'Cash',paidAmount:50,paymentMethod:'Cash',
      items:[{productId:p.productId,name:'Split Safety Cable',qty:1,unitPrice:50}]
    });
    assert.equal(normal.ok,true,JSON.stringify(normal));
    assert.equal(before('sales'),old.sales+1);
  }finally{db.close();}
});
