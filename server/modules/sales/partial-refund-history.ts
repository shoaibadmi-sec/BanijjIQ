import {allocatePartialSplitRefund,type RefundSource} from './partial-split-refunds.js';

/** A database-sourced return plus its independently queried original-source
 * Cash/Bank/Store Credit and FIFO journal evidence. Not an authorization to pay. */
export type HistoricalSplitRefund=Readonly<{
  invoiceId:string;
  returnId:string;
  amountCents:number;
  itemsCents:number;
  returnedQty:number;
  restoredFifoQty:number;
  allocations:readonly RefundSource[];
  journals:readonly RefundSource[];
}>;

const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;

/** Reject incomplete historical money/stock books before quoting another refund.
 * Reuses the tested G2-I allocator for cumulative per-source poisha caps. */
export function quoteVerifiedPartialSplitRefund(
  invoiceId:string,original:readonly RefundSource[],
  history:readonly HistoricalSplitRefund[],requestedCents:number
):readonly RefundSource[]{
  if(!invoiceId||!Array.isArray(history))
    throw new Error('Partial refund needs a valid invoice and return history.');
  const seen=new Set<string>();
  const refunded:RefundSource[]=[];
  for(const ret of history){
    if(!ret||ret.invoiceId!==invoiceId||!ret.returnId||ret.returnId.trim()!==ret.returnId)
      throw new Error('Historical refund belongs to a different invoice or has no return ID.');
    if(seen.has(ret.returnId))throw new Error('Duplicate historical refund return ID.');
    seen.add(ret.returnId);
    if(!positive(ret.amountCents)||ret.amountCents!==ret.itemsCents||
      !positive(ret.returnedQty)||ret.returnedQty!==ret.restoredFifoQty)
      throw new Error('Historical return items or FIFO quantity do not reconcile.');
    if(!Array.isArray(ret.allocations)||!ret.allocations.length||!Array.isArray(ret.journals))
      throw new Error('Historical source journal is missing.');
    const journals=new Map<string,number>();
    for(const journal of ret.journals){
      if(!journal||!journal.sourceKey||!positive(journal.amountCents)||
        journals.has(journal.sourceKey))
        throw new Error('Historical source journal is missing, invalid or duplicated.');
      journals.set(journal.sourceKey,journal.amountCents);
    }
    const allocated=new Set<string>();
    let amount=0;
    for(const source of ret.allocations){
      if(!source||!source.sourceKey||!positive(source.amountCents)||
        allocated.has(source.sourceKey)||journals.get(source.sourceKey)!==source.amountCents)
        throw new Error('Historical refund source journal does not reconcile.');
      allocated.add(source.sourceKey);
      amount+=source.amountCents;
      refunded.push(source);
    }
    if(allocated.size!==journals.size||amount!==ret.amountCents||!Number.isSafeInteger(amount))
      throw new Error('Historical refund sources and return total do not reconcile.');
  }
  return allocatePartialSplitRefund(original,refunded,requestedCents);
}
