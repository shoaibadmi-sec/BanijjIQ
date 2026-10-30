import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedOriginalPosPaymentAccounts, applyOriginalPosPaymentAccounts} from '../overlay/src/integration/originalPosPayments';
import type {PosBootstrap} from '../overlay/src/integration/banijjApi';

const boot=(overrides:Partial<PosBootstrap>={}):PosBootstrap=>({
  ok:true,products:[],customers:[],vendors:[],bankAccounts:[],
  activeSession:null,invoiceDesign:{settings:{},logoDataUri:''},...overrides
});
const accounts=()=>({
  Cash:['DEMO CASH'],Bank:['DEMO BANK'],Card:['DEMO CARD'],
  bKash:['DEMO BKASH'],Nagad:['DEMO NAGAD'],
  'Mobile Banking':['DEMO MOBILE'],'Customer Credit':['DEMO CREDIT']
});

test('authenticated payment account mapping uses only current D1 bank/mobile accounts and verified cash session',()=>{
  const result=verifiedOriginalPosPaymentAccounts(boot({
    activeSession:{sessionId:'SESSION-1',openedAt:'2026-10-30T12:00:00Z',openingCash:100},
    bankAccounts:[
      {id:'AC-B1',name:'Verified Bank A',accountType:'Bank'},
      {id:'AC-M1',name:'Verified Mobile',accountType:'Mobile Banking'},
      {id:'AC-B2',name:'Verified Bank B',accountType:'Bank'}
    ]
  }));
  assert.deepEqual(result.Cash,['Cash counter']);
  assert.deepEqual(result.Bank,['Verified Bank A','Verified Bank B']);
  assert.deepEqual(result['Mobile Banking'],['Verified Mobile']);
  for(const blocked of ['Card','bKash','Nagad','Customer Credit'] as const)
    assert.deepEqual(result[blocked],[],blocked+' cannot borrow a demo account or infer provider/source');
});
test('no cash session or eligible accounts means no fake payment source',()=>{
  const result=verifiedOriginalPosPaymentAccounts(boot());
  for(const rows of Object.values(result))assert.deepEqual(rows,[]);
});
test('invalid account records cannot reach the existing original checkout form',()=>{
  const bad=(bankAccounts:unknown)=>verifiedOriginalPosPaymentAccounts(boot({bankAccounts:bankAccounts as never}));
  assert.throws(()=>bad(null),/accounts/i);
  assert.throws(()=>bad([{id:'',name:'Bank A',accountType:'Bank'}]),/identity/i);
  assert.throws(()=>bad([{id:'AC-1',name:'',accountType:'Bank'}]),/identity/i);
  assert.throws(()=>bad([{id:'AC-1',name:'Same',accountType:'Bank'},{id:'AC-2',name:'Same',accountType:'Bank'}]),/duplicate/i);
  assert.throws(()=>bad([{id:'AC-1',name:'A',accountType:'Bank'},{id:'AC-1',name:'B',accountType:'Mobile Banking'}]),/duplicate/i);
});
test('apply replaces original account arrays in place, never retains demo labels',()=>{
  const original=accounts();
  const result=verifiedOriginalPosPaymentAccounts(boot({
    activeSession:{sessionId:'S1',openedAt:'2026-10-30',openingCash:0},
    bankAccounts:[{id:'BANK-D1',name:'Real Account D1',accountType:'Bank'}]
  }));
  const ref=original.Bank;
  applyOriginalPosPaymentAccounts(original,result);
  assert.strictEqual(original.Bank,ref);
  assert.deepEqual(original.Bank,['Real Account D1']);
  assert.deepEqual(original.Card,[]);
  assert.deepEqual(original['Customer Credit'],[]);
  assert.deepEqual(original.Cash,['Cash counter']);
});
