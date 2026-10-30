import type {PosSaleInput,SaleTenderInput} from './types.js';

export type TenderBankAccount = {
  bankAccountId:string;
  accountType:'Bank'|'Mobile Banking';
  status:string;
  isDeleted:boolean;
};
export type TenderAllocationContext = {
  customer?:{customerId:string;status:string;isDeleted:boolean}|null;
  availableStoreCreditCents?:number;
  legacyReviewRequired?:boolean;
  bankAccounts:readonly TenderBankAccount[];
};
export type NormalizedSaleTender = Readonly<{
  method:SaleTenderInput['method'];
  amountCents:number;
  bankAccountId:string;
  sourceKey:string;
}>;
export type ValidatedTenderAllocation = Readonly<{
  allocations:readonly NormalizedSaleTender[];
  paidCents:number;
  dueCents:number;
}>;

function ensurePoisha(value:unknown,name:string,allowZero=false):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||
     value<0||(!allowZero&&value===0))
    throw new RangeError(name+' must be a '+(allowZero?'nonnegative':'positive')+' integer poisha amount.');
  return value;
}
function activeCustomer(customerId:string,ctx:TenderAllocationContext):boolean {
  return Boolean(customerId&&ctx.customer?.customerId===customerId&&
    ctx.customer.status==='Active'&&ctx.customer.isDeleted===false);
}

/**
 * Validates a proposed POS payment split without altering financial books.
 * A missing/empty tenders field leaves the legacy one-tender API unchanged.
 *
 * IMPORTANT: This validator is deliberately NOT connected to invoice posting
 * yet. G2-G Task 5 must add the complete source-specific transaction before
 * any caller is allowed to commit a split checkout.
 */
export function validateTenderAllocation(
  input:Pick<PosSaleInput,'tenders'>,
  grandTotalCents:number,
  customerId:string,
  accounts:TenderAllocationContext
):ValidatedTenderAllocation|null {
  const total=ensurePoisha(grandTotalCents,'Invoice grand total');
  if(input.tenders===undefined||Array.isArray(input.tenders)&&input.tenders.length===0)
    return null;
  if(!Array.isArray(input.tenders)||input.tenders.length>8)
    throw new Error('Between one and eight tender rows are allowed.');
  const allocations:NormalizedSaleTender[]=[];
  const seen=new Set<string>();
  let sum=0;
  let credit=0;
  for(const row of input.tenders){
    if(!row||typeof row!=='object')throw new Error('Tender row is required.');
    const amount=ensurePoisha(row.amountCents,'Tender amount');
    const method=row.method;
    const bankAccountId=typeof row.bankAccountId==='string'?row.bankAccountId.trim():'';
    if(!['Cash','Bank','Mobile Banking','Store Credit'].includes(method))
      throw new Error('Unsupported tender method.');
    const requiresAccount=method==='Bank'||method==='Mobile Banking';
    if(requiresAccount){
      if(!bankAccountId)throw new Error('Bank or mobile tender requires an account.');
      const bank=accounts.bankAccounts.find(a=>a.bankAccountId===bankAccountId);
      if(!bank||bank.accountType!==method||bank.status!=='Active'||bank.isDeleted)
        throw new Error('The selected bank or mobile account is inactive or mismatched.');
    }else if(bankAccountId){
      throw new Error('Cash and Store Credit must not name a bank account.');
    }
    if(method==='Store Credit'){
      if(!activeCustomer(customerId,accounts))
        throw new Error('Store Credit requires an active matching customer.');
      if(accounts.legacyReviewRequired)
        throw new Error('Historical Store Credit discrepancies must be reconciled first.');
      credit+=amount;
      if(!Number.isSafeInteger(credit)||credit>ensurePoisha(accounts.availableStoreCreditCents,'Available Store Credit',true))
        throw new Error('Store Credit is insufficient.');
    }
    const sourceKey=requiresAccount?method+':'+bankAccountId:method;
    if(seen.has(sourceKey))throw new Error('Duplicate tender source in one sale.');
    seen.add(sourceKey);
    sum+=amount;
    if(!Number.isSafeInteger(sum)||sum>total)throw new Error('Tender sum exceeds invoice total.');
    allocations.push(Object.freeze({method,amountCents:amount,bankAccountId,sourceKey}));
  }
  return Object.freeze({
    allocations:Object.freeze(allocations),
    paidCents:sum,dueCents:total-sum
  });
}
