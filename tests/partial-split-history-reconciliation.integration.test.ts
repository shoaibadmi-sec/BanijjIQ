import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteVerifiedPartialSplitRefund, type HistoricalSplitRefund} from '../server/modules/sales/partial-refund-history.ts';

const original=[
  {sourceKey:'Cash',amountCents:2000},
  {sourceKey:'Store Credit',amountCents:3000}
] as const;

const posted=(returnId:string):HistoricalSplitRefund=>({
  invoiceId:'INV-A',returnId,amountCents:1000,itemsCents:1000,
  returnedQty:1,restoredFifoQty:1,
  allocations:[
    {sourceKey:'Cash',amountCents:400},
    {sourceKey:'Store Credit',amountCents:600}
  ],
  journals:[
    {sourceKey:'Cash',amountCents:400},
    {sourceKey:'Store Credit',amountCents:600}
  ]
});

test('G2-K derives exact remaining refund from two fully reconciled previous returns',()=>{
  const first=posted('SRT-1'),second=posted('SRT-2');
  const snapshot=JSON.stringify([original,first,second]);
  assert.deepEqual(quoteVerifiedPartialSplitRefund('INV-A',original,[first,second],3000),[
    {sourceKey:'Cash',amountCents:1200},
    {sourceKey:'Store Credit',amountCents:1800}
  ]);
  assert.equal(JSON.stringify([original,first,second]),snapshot,'must not alter original financial evidence');
  assert.throws(()=>quoteVerifiedPartialSplitRefund('INV-A',original,[first,second],3001),
    /exceeds remaining/i);
  assert.throws(()=>quoteVerifiedPartialSplitRefund('INV-A',original,[
    posted('SRT-1'),posted('SRT-2'),{...posted('SRT-3'),amountCents:3000,itemsCents:3000,
      allocations:[{sourceKey:'Cash',amountCents:1200},{sourceKey:'Store Credit',amountCents:1800}],
      journals:[{sourceKey:'Cash',amountCents:1200},{sourceKey:'Store Credit',amountCents:1800}]}
  ],1),/exceeds remaining/i);
});

test('G2-K rejects missing, altered, duplicate or extra Cash/Store Credit journal evidence',()=>{
  const originalReturn=posted('SRT-1');
  for(const journals of [
    [{sourceKey:'Cash',amountCents:400}],
    [{sourceKey:'Cash',amountCents:401},{sourceKey:'Store Credit',amountCents:599}],
    [...originalReturn.journals,{sourceKey:'Cash',amountCents:400}],
    [{sourceKey:'Cash',amountCents:400},{sourceKey:'Bank:B-FORGED',amountCents:600}],
    [{sourceKey:'Store Credit',amountCents:1000}]
  ]){
    assert.throws(()=>quoteVerifiedPartialSplitRefund('INV-A',original,[
      {...originalReturn,journals}
    ],100),/journal|reconcil/i);
  }
});

test('G2-K denies forged invoice, duplicate return ID, mismatched return lines or FIFO evidence',()=>{
  const valid=posted('SRT-1');
  for(const bad of [
    {...valid,invoiceId:'INV-OTHER'},
    {...valid,itemsCents:900},
    {...valid,restoredFifoQty:0},
    {...valid,restoredFifoQty:2},
    {...valid,returnedQty:0},
    {...valid,amountCents:999},
    {...valid,allocations:[{sourceKey:'Cash',amountCents:999}]}
  ]) assert.throws(()=>quoteVerifiedPartialSplitRefund('INV-A',original,[bad],100));
  assert.throws(()=>quoteVerifiedPartialSplitRefund('INV-A',original,[valid,valid],100),
    /duplicate/i);
});

test('G2-K refuses cumulative overdraw and unknown source even with forged matching journals',()=>{
  const overdraw={...posted('SRT-1'),amountCents:2100,itemsCents:2100,
    allocations:[{sourceKey:'Cash',amountCents:2100}],
    journals:[{sourceKey:'Cash',amountCents:2100}]};
  assert.throws(()=>quoteVerifiedPartialSplitRefund('INV-A',original,[overdraw],100),/exceeds original tender/i);
  const unknown={...posted('SRT-1'),allocations:[{sourceKey:'Mobile Banking:BAD',amountCents:1000}],
    journals:[{sourceKey:'Mobile Banking:BAD',amountCents:1000}]};
  assert.throws(()=>quoteVerifiedPartialSplitRefund('INV-A',original,[unknown],100),
    /not on original invoice/i);
  assert.deepEqual(quoteVerifiedPartialSplitRefund('INV-A',original,[],1000),[
    {sourceKey:'Cash',amountCents:400},{sourceKey:'Store Credit',amountCents:600}
  ]);
});
