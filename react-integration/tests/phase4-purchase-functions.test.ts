import test from 'node:test';
import assert from 'node:assert/strict';
import * as purchaseApi from '../overlay/src/integration/purchaseApi.ts';
import {quotePurchaseLine,quoteOriginalReturn,validateDuePurchase}
 from '../overlay/src/integration/purchaseApi.ts';

// Real purchase business functions, with fixed independent arithmetic expectations.
const supplier={id:'SUP-TEST',name:'Hardware Supplier',phone:'0123',currentDue:50,
 ledgerDue:50,needsReconciliation:false};
const profile={baseUnit:'Pcs',units:[
 {unit:'Carton',symbol:'CT',containsNext:12,factor:240,sellingPrice:2400},
 {unit:'Box',symbol:'BX',containsNext:20,factor:20,sellingPrice:200},
 {unit:'Pcs',symbol:'PCS',containsNext:null,factor:1,sellingPrice:10}
]} as Parameters<typeof quotePurchaseLine>[0];

test('purchase quote: 1 carton, 2 boxes and 3 pieces are 283 pieces costing 2830',()=>{
 const result=quotePurchaseLine(profile,{Carton:1,Box:2,Pcs:3},'Carton',2400);
 assert.deepEqual(result,{qty:283,total:2830,baseUnitCost:10});
 assert.equal(quotePurchaseLine(profile,{Box:1,Pcs:2},'Box',200).total,220);
 for(const quantities of [{Carton:0,Box:0,Pcs:0},{Box:-1},{Pcs:1.5},{Unknown:3}]){
  assert.throws(()=>quotePurchaseLine(profile,quantities,'Carton',2400));
 }
 assert.throws(()=>quotePurchaseLine(profile,{Pcs:1},'Unlisted',10));
 assert.throws(()=>quotePurchaseLine(profile,{Pcs:1},'Carton',0.00001));
});

test('return quote uses immutable original purchase cost and cumulative original rounding',()=>{
 const source={boughtQty:283,previouslyReturnedQty:0,availableQty:283,
  originalLineTotal:2830,unitSnapshot:{
   revision:1,profile,quantities:{Carton:1,Box:2,Pcs:3},priceUnit:'Carton',
   enteredUnitPrice:2400,description:'1 CT 2 BX 3 PCS',sourceLotId:'LOT-ORIGINAL'}
 } as Parameters<typeof quoteOriginalReturn>[0];
 assert.deepEqual(quoteOriginalReturn(source,{Box:1,Pcs:2}),{qty:22,amount:220});
 assert.throws(()=>quoteOriginalReturn({...source,availableQty:5},{Box:1,Pcs:2}),
  /available original stock/);
 assert.throws(()=>quoteOriginalReturn({...source,unitSnapshot:null},{Pcs:1}),
  /Original unit snapshot/);
});

test('purchase form forbids negative, fractional, missing or nonfinite mixed-unit counts',()=>{
 const valid={productId:'PRD-1',qty:20,unitProfileRevision:1,priceUnit:'Box',
  unitPrice:200,unitQuantities:{Box:1}};
 assert.equal(validateDuePurchase(supplier,[valid]).items.length,1);
 for(const counts of [{Box:-1},{Box:1.5},{Box:0},{Box:NaN},{Box:Infinity},
   {Box:-1,Pcs:2}]){
  assert.throws(()=>validateDuePurchase(supplier,[{...valid,unitQuantities:counts}]),
   /unit|quantity|quantities/i,'Cannot submit invalid mixed-unit quantities');
 }
});

test('purchase form rejects unreconciled suppliers, duplicate products, and invalid base quantities',()=>{
 const line={productId:'PRD-1',qty:2,unitPrice:50};
 assert.throws(()=>validateDuePurchase(null,[line]),/supplier/i);
 assert.throws(()=>validateDuePurchase({...supplier,needsReconciliation:true},[line]),
  /reconciliation/i);
 assert.throws(()=>validateDuePurchase(supplier,[line,line]),/distinct/i);
 for(const qty of [-1,0,1.00001,Infinity]){
  assert.throws(()=>validateDuePurchase(supplier,[{...line,qty}]),/Quantity/i);
 }
 assert.deepEqual(validateDuePurchase(supplier,[line],'SPO-TEST'),{
  supplierId:'SUP-TEST',paidAmount:0,discount:0,purchasePlanOrderId:'SPO-TEST',
  items:[line]
 });
});

test('4I-B paid purchase requires an open session, exact cash amount, and stable request ID',()=>{
 const make=(purchaseApi as unknown as {validatePurchasePayment:Function}).validatePurchasePayment;
 assert.equal(typeof make,'function','Paid purchase payload builder must exist');
 const line={productId:'PRD-1',qty:2,unitPrice:50};
 const due=make(supplier,[line],{method:'Due',amount:0},'','');
 assert.deepEqual(due,{supplierId:'SUP-TEST',paidAmount:0,discount:0,
  purchasePlanOrderId:'',items:[line]});
 const cash=make(supplier,[line],{method:'Cash',amount:40,activeSession:true},
  '123e4567-e89b-42d3-a456-426614174000','');
 assert.deepEqual(cash,{...due,paidAmount:40,paymentMethod:'Cash',
  clientRequestId:'123e4567-e89b-42d3-a456-426614174000'});
 for(const amount of [0,-1,100.0001,0.00001,NaN,Infinity]){
  assert.throws(()=>make(supplier,[line],{method:'Cash',amount,activeSession:true},
   '123e4567-e89b-42d3-a456-426614174000',''),/amount|payment/i);
 }
 assert.throws(()=>make(supplier,[line],{method:'Cash',amount:40,activeSession:false},
  '123e4567-e89b-42d3-a456-426614174000',''),/session/i);
 assert.throws(()=>make(supplier,[line],{method:'Cash',amount:40,activeSession:true},
  'different-id',''),/request/i);
 assert.throws(()=>make({...supplier,needsReconciliation:true},[line],
  {method:'Cash',amount:40,activeSession:true},
  '123e4567-e89b-42d3-a456-426614174000',''),/reconcil/i);
});

test('4I-B bank/mobile tender must match an active account and sufficient live balance',()=>{
 const make=(purchaseApi as unknown as {validatePurchasePayment:Function}).validatePurchasePayment;
 const line={productId:'PRD-1',qty:1,unitPrice:120};
 const accounts=[
  {id:'BANK-1',name:'Current',type:'Bank',currentBalance:100},
  {id:'MOBILE-1',name:'Mobile',type:'Mobile Banking',currentBalance:200}
 ];
 const key='123e4567-e89b-42d3-a456-426614174001';
 const bank=make(supplier,[line],{method:'Bank',amount:70,bankAccountId:'BANK-1',
  activeSession:true,bankAccounts:accounts},key,'');
 assert.equal(bank.bankAccountId,'BANK-1');
 assert.equal(bank.paymentMethod,'Bank');
 assert.equal(bank.paidAmount,70);
 const mobile=make(supplier,[line],{method:'Mobile Banking',amount:120,bankAccountId:'MOBILE-1',
  activeSession:true,bankAccounts:accounts},key,'');
 assert.equal(mobile.bankAccountId,'MOBILE-1');
 for(const details of [
  {method:'Bank',amount:70,bankAccountId:'MISSING'},
  {method:'Bank',amount:101,bankAccountId:'BANK-1'},
  {method:'Bank',amount:70,bankAccountId:'MOBILE-1'},
  {method:'Mobile Banking',amount:70,bankAccountId:'BANK-1'},
  {method:'Bank',amount:70,bankAccountId:''}
 ]){
  assert.throws(()=>make(supplier,[line],
   {...details,activeSession:true,bankAccounts:accounts},key,''),/account|balance/i);
 }
});

test('4I-B mixed-unit paid purchases stay locked; due remains valid',()=>{
 const make=(purchaseApi as unknown as {validatePurchasePayment:Function}).validatePurchasePayment;
 const mixed={productId:'PRD-1',qty:20,unitPrice:200,unitProfileRevision:1,
  unitQuantities:{Box:1},priceUnit:'Box'};
 assert.equal(make(supplier,[mixed],{method:'Due',amount:0},'','').paidAmount,0);
 assert.throws(()=>make(supplier,[mixed],{method:'Cash',amount:20,activeSession:true},
  '123e4567-e89b-42d3-a456-426614174000',''),/mixed.unit|due/i);
});
