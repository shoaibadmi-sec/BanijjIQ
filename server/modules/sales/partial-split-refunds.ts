/** G2-I: Pure allocation for a future audited partial split-return transaction.
 * No financial posting here: the existing full-return D1 guards stay unchanged.
 * Each remaining original tender source is its own capacity (never substitute Cash).
 */
export type RefundSource = Readonly<{sourceKey:string;amountCents:number}>;

function positivePoisha(value:unknown):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)
    throw new RangeError('Refund source must be positive integer poisha.');
  return value;
}

export function allocatePartialSplitRefund(
  original:readonly RefundSource[],alreadyRefunded:readonly RefundSource[],requestedCents:number
):readonly RefundSource[]{
  if(!Array.isArray(original)||original.length<2||original.length>8||
    !Array.isArray(alreadyRefunded))
    throw new RangeError('Split refund requires two to eight original sources and valid history.');
  const remaining=new Map<string,number>();
  let originalTotal=0;
  for(const row of original){
    if(!row||typeof row.sourceKey!=='string'||!row.sourceKey.trim()||
      row.sourceKey!==row.sourceKey.trim()||remaining.has(row.sourceKey))
      throw new Error('Original refund source identity is missing or duplicated.');
    const amount=positivePoisha(row.amountCents);
    originalTotal+=amount;
    if(!Number.isSafeInteger(originalTotal))throw new RangeError('Invoice poisha total is unsafe.');
    remaining.set(row.sourceKey,amount);
  }
  for(const row of alreadyRefunded){
    if(!row||!remaining.has(row.sourceKey))
      throw new Error('Historical refund source is not on original invoice.');
    const prior=positivePoisha(row.amountCents);
    const left=remaining.get(row.sourceKey)!-prior;
    if(left<0)throw new RangeError('Source refund exceeds original tender.');
    remaining.set(row.sourceKey,left);
  }
  const available=[...remaining.values()].reduce((a,b)=>a+b,0);
  if(!Number.isSafeInteger(available)||typeof requestedCents!=='number'||
    !Number.isSafeInteger(requestedCents)||requestedCents<=0||requestedCents>available)
    throw new RangeError('Partial refund exceeds remaining original-source funds.');
  const total=BigInt(available),requested=BigInt(requestedCents);
  const allocation=original.map((row,index)=>{
    const left=remaining.get(row.sourceKey)!;
    const weighted=BigInt(left)*requested;
    return {sourceKey:row.sourceKey,index,left,amount:Number(weighted/total),
      fractional:weighted%total};
  });
  let spare=requestedCents-allocation.reduce((n,a)=>n+a.amount,0);
  for(const row of [...allocation].sort((a,b)=>
    a.fractional===b.fractional?a.index-b.index:a.fractional>b.fractional?-1:1)){
    if(spare===0)break;
    if(row.amount<row.left){row.amount++;spare--;}
  }
  if(spare!==0)throw new RangeError('Refund allocation could not conserve poisha.');
  return Object.freeze(allocation.filter(row=>row.amount>0).map(row=>
    Object.freeze({sourceKey:row.sourceKey,amountCents:row.amount})
  ));
}
