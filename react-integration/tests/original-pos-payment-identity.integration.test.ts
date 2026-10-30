import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOriginalPosSinglePayment} from '../overlay/src/integration/originalPosPayments';
import type {PosBootstrap} from '../overlay/src/integration/banijjApi';
import type {PosPaymentRow} from '../overlay/src/hooks/usePosCart';

const pos=(overrides:Partial<PosBootstrap>={}):PosBootstrap=>({
  ok:true,products:[],customers:[],vendors:[],
  bankAccounts:[
    {id:'BANK-D1-001',name:'Actual Bank',accountType:'Bank'},
    {id:'MOBILE-D1-002',name:'Merchant Wallet',accountType:'Mobile Banking'}
  ],
  activeSession:{sessionId:'SESSION-D1-1',openedAt:'2026-10-30T09:00:00Z',openingCash:0},
  invoiceDesign:{settings:{},logoDataUri:''},...overrides
});
const row=(method:PosPaymentRow['method'],account:string,amount:string):PosPaymentRow=>({
  id:'payment-1',method,account,amount
});

test('the original HisabIQ Bank account choice resolves to D1 stable account ID',()=>{
  assert.deepEqual(resolveOriginalPosSinglePayment([row('Bank','Actual Bank','125.50')],pos()),{
    method:'Bank',bankAccountId:'BANK-D1-001',paidAmount:125.5
  });
});
test('explicit Mobile Banking resolves to its own D1 account, never a bank account',()=>{
  assert.deepEqual(resolveOriginalPosSinglePayment([row('Mobile Banking','Merchant Wallet','100')],pos()),{
    method:'Mobile Banking',bankAccountId:'MOBILE-D1-002',paidAmount:100
  });
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Bank','Merchant Wallet','100')],pos()),/account/i);
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Mobile Banking','Actual Bank','100')],pos()),/account/i);
});
test('Cash uses verified open session, never a made-up bank account ID',()=>{
  assert.deepEqual(resolveOriginalPosSinglePayment([row('Cash','Cash counter','13.25')],pos()),{
    method:'Cash',paidAmount:13.25
  });
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Cash','Cash counter','13')],pos({activeSession:null})),/cash session/i);
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Cash','DEMO CASH','13')],pos()),/account/i);
});
test('unsupported methods and split rows fail closed until backend supports atomic multiple payments',()=>{
  for(const unsupported of ['Card','bKash','Nagad','Customer Credit'] as const){
    assert.throws(()=>resolveOriginalPosSinglePayment([row(unsupported,'Any','15')],pos()),/unsupported/i);
  }
  assert.throws(()=>resolveOriginalPosSinglePayment([
    row('Bank','Actual Bank','10'),{...row('Cash','Cash counter','20'),id:'payment-2'}
  ],pos()),/split|multiple/i);
  assert.throws(()=>resolveOriginalPosSinglePayment([],pos()),/payment/i);
});
test('ambiguous, unknown, disabled or stale source account IDs are rejected',()=>{
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Bank','Old Demo Bank','10')],pos()),/account/i);
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Bank','Actual Bank','10')],pos({
    bankAccounts:[{id:'BANK-1',name:'Actual Bank',accountType:'Bank'},{id:'BANK-2',name:'Actual Bank',accountType:'Bank'}]
  })),/ambiguous|duplicate/i);
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Bank','Actual Bank','10')],pos({bankAccounts:[]})),/account/i);
  assert.throws(()=>resolveOriginalPosSinglePayment([row('Bank','Actual Bank','10')],pos({bankAccounts:null as never})),/accounts/i);
});
test('bad money amounts are rejected, never rounded or coerced to zero',()=>{
  for(const amount of ['', 'NaN', 'Infinity', '-10', '10.999','1e3','12,000',' 2 ']){
    assert.throws(()=>resolveOriginalPosSinglePayment([row('Bank','Actual Bank',amount)],pos()),/amount/i,amount);
  }
  assert.deepEqual(resolveOriginalPosSinglePayment([row('Bank','Actual Bank','0.01')],pos()),{
    method:'Bank',bankAccountId:'BANK-D1-001',paidAmount:0.01
  });
});
