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


test('4I-C4 paid Cash refund posts immutable original price, available quantity, and unique receipt ID',()=>{
 const make=(purchaseApi as unknown as {validatePaidPurchaseRefund:Function}).validatePaidPurchaseRefund;
 assert.equal(typeof make,'function','C4 paid refund validator must exist');
 const purchase={purchaseId:'PUR-PAID',supplierId:'SUP-TEST',status:'Completed',paymentMethod:'Cash',
  bankAccountId:'',paidAmount:100,grandTotal:100,dueAmount:0,discount:0,returnedAmount:0};
 const lines=[{productId:'PRD-1',productName:'Bolts',boughtQty:2,unitPrice:50,
  previouslyReturnedQty:0,availableQty:2,trackSerial:0,trackExpiry:0}];
 const settlement={supplier:{id:'SUP-TEST',currentDue:0},ledgerDue:0,
  needsReconciliation:false,activeSession:true,bankAccounts:[]};
 const requestId='123e4567-e89b-42d3-a456-426614174002';
 assert.deepEqual(make(purchase,lines,settlement,{ 'PRD-1':1},'Damaged items',requestId),{
  purchaseId:'PUR-PAID',refundMethod:'Cash',bankAccountId:'',clientRequestId:requestId,
  reason:'Damaged items',items:[{productId:'PRD-1',qty:1,unitPrice:50}]
 });
 assert.throws(()=>make(purchase,lines,settlement,{'PRD-1':3},'Damaged',requestId),/available|quantity/i);
 assert.throws(()=>make(purchase,lines,settlement,{'PRD-1':1.00001},'Damaged',requestId),/quantity|decimals/i);
 assert.throws(()=>make(purchase,lines,settlement,{'PRD-1':0},'Damaged',requestId),/product|quantity/i);
 assert.throws(()=>make(purchase,lines,settlement,{'PRD-2':1},'Damaged',requestId),/product|source/i);
 assert.throws(()=>make(purchase,lines,settlement,{'PRD-1':1},'',requestId),/reason/i);
 assert.throws(()=>make(purchase,lines,settlement,{'PRD-1':1},'Damaged','bad-key'),/request ID/i);
 assert.throws(()=>make({...purchase,dueAmount:60,paidAmount:40},lines,settlement,
  {'PRD-1':1},'Damaged',requestId),/fully paid/i);
 assert.throws(()=>make({...purchase,discount:1},lines,settlement,
  {'PRD-1':1},'Damaged',requestId),/undiscounted/i);
 assert.throws(()=>make(purchase,lines,{...settlement,activeSession:false},
  {'PRD-1':1},'Damaged',requestId),/session/i);
 assert.throws(()=>make(purchase,lines,{...settlement,needsReconciliation:true},
  {'PRD-1':1},'Damaged',requestId),/reconcil/i);
 assert.throws(()=>make(purchase,[{...lines[0],trackExpiry:1}],settlement,
  {'PRD-1':1},'Damaged',requestId),/tracked|expiry/i);
 assert.throws(()=>make(purchase,[{...lines[0],unitSnapshot:{}}],settlement,
  {'PRD-1':1},'Damaged',requestId),/mixed.unit/i);
});
test('4I-C4 Bank and Mobile refund only accept matching original payment account, not arbitrary account',()=>{
 const make=(purchaseApi as unknown as {validatePaidPurchaseRefund:Function}).validatePaidPurchaseRefund;
 const base={purchaseId:'PUR-BANK',supplierId:'SUP-TEST',status:'Completed',paymentMethod:'Bank',
  bankAccountId:'BANK-ORIGINAL',paidAmount:100,grandTotal:100,dueAmount:0,discount:0,returnedAmount:40};
 const lines=[{productId:'PRD-1',productName:'Bolts',boughtQty:2,unitPrice:50,
  previouslyReturnedQty:0.8,availableQty:1.2,trackSerial:0,trackExpiry:0}];
 const settlement={supplier:{id:'SUP-TEST',currentDue:0},ledgerDue:0,
  needsReconciliation:false,activeSession:true,bankAccounts:[
    {id:'BANK-ORIGINAL',type:'Bank',name:'Bank 1',currentBalance:100},
    {id:'BANK-OTHER',type:'Bank',name:'Bank 2',currentBalance:100},
    {id:'MOBILE-ORIGINAL',type:'Mobile Banking',name:'Mobile',currentBalance:100}
  ]};
 const requestId='123e4567-e89b-42d3-a456-426614174003';
 const value=make(base,lines,settlement,{'PRD-1':1},'Wrong shipment',requestId);
 assert.equal(value.refundMethod,'Bank');assert.equal(value.bankAccountId,'BANK-ORIGINAL');
 assert.equal(value.items[0].unitPrice,50);
 assert.equal(value.items[0].qty,1);
 assert.throws(()=>make({...base,bankAccountId:'BANK-MISSING'},lines,settlement,
  {'PRD-1':1},'Wrong shipment',requestId),/original.*account/i);
 assert.throws(()=>make({...base,paymentMethod:'Mobile Banking'},lines,settlement,
  {'PRD-1':1},'Wrong shipment',requestId),/original.*account/i);
 assert.throws(()=>make({...base,returnedAmount:80},lines,settlement,
  {'PRD-1':1},'Wrong shipment',requestId),/remaining.*refund/i);
 assert.throws(()=>make(base,lines,{...settlement,bankAccounts:[]},
  {'PRD-1':1},'Wrong shipment',requestId),/original.*account/i);
});
