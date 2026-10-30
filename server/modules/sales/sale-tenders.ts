import type {PosSaleInput,PosSaleTenderInput} from './types.js';

/**
 * G2-G Task 4: immutable, exact-poisha preflight ONLY.
 * This helper does not write payments. The checkout route rejects tenders
 * until Task 5 posts the individual cash, bank and credit sources atomically.
 */
export type TenderAccount = Readonly<{
  bankAccountId:string;
  accountType:'Bank'|'Mobile Banking'|string;
  status:string;
}>;
export type NormalizedTender = Readonly<{
  allocationId:string;
  ordinal:number;
  method:PosSaleTenderInput['method'];
  amountCents:number;
  bankAccountId:string;
}>;
export type TenderAllocation = Readonly<{
  allocations:readonly NormalizedTender[];
  paidCents:number;
  dueCents:number;
}>;

export function validateTenderAllocation(
  input:PosSaleInput,
  grandTotalCents:number,
  customerId:string,
  accounts:readonly TenderAccount[],
  availableCreditCents=0
):TenderAllocation|null{
  // Legacy one-source POS clients must keep the existing behavior.
  if(input.tenders===undefined)return null;
  if(!Number.isSafeInteger(grandTotalCents)||grandTotalCents<=0)
    throw new Error('Invoice net total must be a positive integer poisha amount.');
  if(!Array.isArray(input.tenders)||input.tenders.length===0)
    throw new Error('Split tenders require at least one allocation.');
  if(input.tenders.length>12)
    throw new Error('Split tender allocations are limited to 12 rows.');
  const permitted=new Set<PosSaleTenderInput['method']>([
    'Cash','Bank','Mobile Banking','Store Credit'
  ]);
  const rows:NormalizedTender[]=[];
  const seenIds=new Set<string>();
  let paidCents=0,creditCount=0;
  for(let index=0;index<input.tenders.length;index++){
    const raw=input.tenders[index];
    if(!raw||typeof raw!=='object'||!permitted.has(raw.method))
      throw new Error('Unsupported split tender source.');
    if(!Number.isSafeInteger(raw.amountCents)||raw.amountCents<=0)
      throw new Error('Each split tender must use a positive integer poisha amount.');
    if(!Number.isSafeInteger(paidCents+raw.amountCents))
      throw new Error('Split tender total is outside the supported integer-poisha range.');
    const allocationId=raw.allocationId===undefined
      ?'ROW-'+String(index+1):String(raw.allocationId);
    if(!/^[A-Za-z0-9_-]{1,96}$/.test(allocationId))
      throw new Error('Invalid tender allocation ID.');
    if(seenIds.has(allocationId))throw new Error('Duplicate tender allocation ID.');
    seenIds.add(allocationId);
    const bankAccountId=String(raw.bankAccountId||'').trim();
    if(raw.method==='Bank'||raw.method==='Mobile Banking'){
      if(!bankAccountId)throw new Error('A bank/mobile banking account is required.');
      if(!accounts.some(a=>a.bankAccountId===bankAccountId&&
        a.status==='Active'&&a.accountType===raw.method))
        throw new Error('Bank/mobile account must be active and match the tender type.');
    }else if(bankAccountId){
      throw new Error('Cash and Store Credit tenders cannot specify a bank account.');
    }
    if(raw.method==='Store Credit'){
      creditCount++;
      if(creditCount>1)throw new Error('Duplicate Store Credit tender is not supported.');
      if(!customerId||!customerId.trim())
        throw new Error('Store Credit requires a selected ledger customer.');
      if(!Number.isSafeInteger(availableCreditCents)||availableCreditCents<raw.amountCents)
        throw new Error('Insufficient verified Store Credit balance.');
    }
    paidCents+=raw.amountCents;
    if(paidCents>grandTotalCents)
      throw new Error('Split tender total exceeds the invoice net amount (overpayment).');
    rows.push(Object.freeze({
      allocationId,ordinal:index+1,method:raw.method,
      amountCents:raw.amountCents,bankAccountId
    }));
  }
  const dueCents=grandTotalCents-paidCents;
  if(dueCents>0){
    if(creditCount>0)
      throw new Error('Store Credit plus due remains disabled until receivable settlement is audited.');
    if(input.paymentType!=='Partial')
      throw new Error('Unpaid split tender total must explicitly use Partial due settlement.');
  }else if(input.paymentType==='Due'){
    throw new Error('Fully paid split sale cannot use Due payment type.');
  }
  return Object.freeze({
    allocations:Object.freeze(rows),paidCents,dueCents
  });
}
