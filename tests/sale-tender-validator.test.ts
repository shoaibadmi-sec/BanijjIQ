import test from 'node:test';
import assert from 'node:assert/strict';
import type {PosSaleInput} from '../server/modules/sales/types.ts';

test('G2-G exact-poisha allocation validates sources without posting or rounding',async()=>{
  let mod:any;
  try{mod=await import('../server/modules/sales/sale-tenders.ts');}
  catch{assert.fail('G2-G source-specific allocation validator is not implemented');}
  assert.equal(typeof mod.validateTenderAllocation,'function');
  const accounts=[
    {bankAccountId:'BANK-1',accountType:'Bank',status:'Active'},
    {bankAccountId:'MOBILE-1',accountType:'Mobile Banking',status:'Active'},
    {bankAccountId:'OLD-1',accountType:'Bank',status:'Inactive'}
  ];
  const quote=(tenders:any,grand=5000,customer='CUSTOMER-1',credit=5000,
    paymentType:PosSaleInput['paymentType']='Cash')=>
      mod.validateTenderAllocation({tenders,paymentType} as PosSaleInput,grand,customer,accounts,credit);
  assert.equal(mod.validateTenderAllocation({paymentType:'Cash'},5000,'',[],0),null,
    'legacy single-tender checkout must remain backward compatible');
  const cashCredit=quote([
    {method:'Cash',amountCents:2000,allocationId:'CASH-01'},
    {method:'Store Credit',amountCents:3000,allocationId:'CREDIT-01'}
  ]);
  assert.deepEqual([cashCredit.paidCents,cashCredit.dueCents],[5000,0]);
  assert.deepEqual(cashCredit.allocations.map((a:any)=>a.method),['Cash','Store Credit']);
  assert.equal(cashCredit.allocations[1].amountCents,3000);
  const mixed=quote([
    {method:'Bank',amountCents:1000,bankAccountId:'BANK-1',allocationId:'B1'},
    {method:'Mobile Banking',amountCents:2000,bankAccountId:'MOBILE-1',allocationId:'M1'},
    {method:'Store Credit',amountCents:2000,allocationId:'SC1'}
  ]);
  assert.equal(mixed.paidCents,5000);
  assert.equal(mixed.dueCents,0);
  assert.throws(()=>quote([{method:'Cash',amountCents:5001}]),/exceeds|overpay/i);
  assert.throws(()=>quote([{method:'Cash',amountCents:-1}]),/positive|poisha/i);
  assert.throws(()=>quote([{method:'Cash',amountCents:0.25}]),/integer|poisha/i);
  assert.throws(()=>quote([{method:'Cash',amountCents:Number.NaN}]),/integer|poisha/i);
  assert.throws(()=>quote([]),/at least one/i);
  assert.throws(()=>quote([
    {method:'Cash',amountCents:2000,allocationId:'DUP'},
    {method:'Cash',amountCents:3000,allocationId:'DUP'}
  ]),/duplicate/i);
  assert.throws(()=>quote([{method:'Bank',amountCents:5000}]),/account/i);
  assert.throws(()=>quote([{method:'Bank',amountCents:5000,bankAccountId:'OLD-1'}]),/account|active/i);
  assert.throws(()=>quote([{method:'Mobile Banking',amountCents:5000,bankAccountId:'BANK-1'}]),/account|type/i);
  assert.throws(()=>quote([{method:'Store Credit',amountCents:5000}],5000,''),/customer/i);
  assert.throws(()=>quote([{method:'Store Credit',amountCents:5000}],5000,'CUSTOMER-1',1000),/balance|credit/i);
  assert.throws(()=>quote([
    {method:'Store Credit',amountCents:1000},
    {method:'Store Credit',amountCents:4000}
  ]),/duplicate|one Store Credit/i);
  assert.throws(()=>quote([
    {method:'Store Credit',amountCents:1000},{method:'Cash',amountCents:2000}
  ],5000,'CUSTOMER-1',5000,'Partial'),/credit.*due|due.*credit/i);
  const partial=quote([{method:'Cash',amountCents:2000}],5000,'CUSTOMER-1',0,'Partial');
  assert.deepEqual([partial.paidCents,partial.dueCents],[2000,3000]);
  assert.throws(()=>quote([{method:'Cash',amountCents:2000}]),/due|total/i);
  assert.ok(Object.isFrozen(mixed.allocations));
  assert.ok(Object.isFrozen(mixed.allocations[0]));
});
