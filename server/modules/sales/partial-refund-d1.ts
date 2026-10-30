import type {SherDatabase} from '../../db/types.js';
import {quoteVerifiedPartialSplitRefund,type HistoricalSplitRefund} from './partial-refund-history.js';
import type {RefundSource} from './partial-split-refunds.js';

const cents=(value:unknown):number=>{
  const n=Number(value),v=n*100;
  if(!Number.isFinite(n)||!Number.isSafeInteger(Math.round(v))||
    Math.abs(v-Math.round(v))>0.00001)
    throw new Error('Financial journal amount does not reconcile to integer poisha.');
  return Math.round(v);
};
const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;
const invalid=(reason:string):never=>{throw new Error('Partial refund history does not reconcile: '+reason);};

/**
 * READ-ONLY evidence query for the future atomic partial-refund path.
 * No HTTP POST calls this helper. Verify actual SQL money and FIFO journals,
 * not merely the stored allocation claims. Final source authorization,
 * idempotency and D1 batch audit remain separate release gates.
 */
export async function quotePartialSplitRefundFromD1(
  db:SherDatabase,invoiceId:string,requestedCents:number
):Promise<readonly RefundSource[]>{
  const sale=await db.prepare(
    'SELECT invoice_id,customer_id,customer_phone,grand_total,subtotal,discount,paid_amount,due_amount,'+
    'payment_type,payment_method,status,is_deleted FROM sales WHERE invoice_id=?'
  ).bind(invoiceId).first<any>();
  if(!sale||sale.status!=='Completed'||Number(sale.is_deleted)!==0||
    sale.payment_type!=='Cash'||sale.payment_method!=='Split'||
    cents(sale.paid_amount)!==cents(sale.grand_total)||cents(sale.due_amount)!==0||
    cents(sale.subtotal)!==cents(sale.grand_total)||cents(sale.discount)!==0)
    return invalid('original split sale is not an unchanged, fully paid invoice');
  const originalRows=(await db.prepare(
    'SELECT method,source_key,amount_cents,customer_id,bank_account_id '+
    'FROM sale_tender_allocations WHERE invoice_id=? ORDER BY line_number'
  ).bind(invoiceId).all<any>()).results||[];
  const original:RefundSource[]=originalRows.map(row=>({
    sourceKey:String(row.source_key),amountCents:Number(row.amount_cents)
  }));
  if(original.length<2||original.length>8||
    original.some(x=>!positive(x.amountCents))||
    original.reduce((n,x)=>n+x.amountCents,0)!==cents(sale.grand_total))
    return invalid('original source amount differs from the fully paid invoice');
  const sourceByKey=new Map<string,any>();
  for(const source of originalRows){
    if(sourceByKey.has(source.source_key))return invalid('duplicate original tender');
    sourceByKey.set(source.source_key,source);
  }
  const returns=(await db.prepare(
    'SELECT return_id,invoice_id,refund_method,customer_id,customer_phone,total_return_amount '+
    'FROM sales_returns WHERE invoice_id=? ORDER BY return_id'
  ).bind(invoiceId).all<any>()).results||[];
  const history:HistoricalSplitRefund[]=[];
  for(const sr of returns){
    if(sr.refund_method!=='Split Partial'||sr.invoice_id!==invoiceId||
      sr.customer_id!==sale.customer_id||sr.customer_phone!==sale.customer_phone)
      return invalid('return method, invoice or customer ownership does not match');
    const returnId=String(sr.return_id);
    const itemRows=(await db.prepare(
      'SELECT invoice_id,product_id,return_quantity,line_total '+
      'FROM sales_return_items WHERE return_id=?'
    ).bind(returnId).all<any>()).results||[];
    if(!itemRows.length)return invalid('return item journal is missing');
    let itemsCents=0,returnedQty=0;
    const quantities=new Map<string,number>();
    for(const item of itemRows){
      const qty=Number(item.return_quantity);
      if(item.invoice_id!==invoiceId||!item.product_id||
        !positive(qty)||quantities.has(item.product_id)||cents(item.line_total)<=0)
        return invalid('return item or quantity is invalid');
      quantities.set(item.product_id,qty);
      returnedQty+=qty;itemsCents+=cents(item.line_total);
    }
    const fifo=(await db.prepare(
      'SELECT invoice_id,product_id,lot_id,quantity FROM sales_return_item_lots WHERE return_id=?'
    ).bind(returnId).all<any>()).results||[];
    const restored=new Map<string,number>();
    let restoredFifoQty=0;
    for(const lot of fifo){
      const qty=Number(lot.quantity);
      if(lot.invoice_id!==invoiceId||!positive(qty)||
        !quantities.has(lot.product_id))
        return invalid('FIFO evidence does not belong to this return');
      const sold=await db.prepare(
        'SELECT COALESCE(SUM(quantity),0) qty FROM sale_item_lots '+
        'WHERE invoice_id=? AND product_id=? AND lot_id=?'
      ).bind(invoiceId,lot.product_id,lot.lot_id).first<any>();
      if(Number(sold?.qty||0)<qty)return invalid('FIFO lot was not sold on the original invoice');
      restored.set(lot.product_id,(restored.get(lot.product_id)||0)+qty);
      restoredFifoQty+=qty;
    }
    if(!fifo.length||[...quantities].some(([p,q])=>restored.get(p)!==q))
      return invalid('FIFO quantity does not match returned product quantity');
    const movements=(await db.prepare(
      'SELECT product_id,movement_type,quantity_in,quantity_out,note '+
      'FROM stock_movements WHERE note=?'
    ).bind(returnId).all<any>()).results||[];
    const movementQty=new Map<string,number>();
    for(const movement of movements){
      const qty=Number(movement.quantity_in);
      if(movement.note!==returnId||movement.movement_type!=='Sales Return'||
        !positive(qty)||Number(movement.quantity_out)!==0||
        !quantities.has(movement.product_id)||movementQty.has(movement.product_id))
        return invalid('stock movement journal is missing or invalid');
      movementQty.set(movement.product_id,qty);
    }
    if(movementQty.size!==quantities.size||
      [...quantities].some(([p,q])=>movementQty.get(p)!==q))
      return invalid('stock movement and FIFO return amounts disagree');
    const allocationRows=(await db.prepare(
      'SELECT method,source_key,amount_cents,bank_account_id,customer_id '+
      'FROM split_partial_refund_allocations WHERE return_id=?'
    ).bind(returnId).all<any>()).results||[];
    const allocations:RefundSource[]=allocationRows.map(a=>({
      sourceKey:String(a.source_key),amountCents:Number(a.amount_cents)
    }));
    if(!allocations.length||allocationRows.some(a=>{
      const t=sourceByKey.get(a.source_key);
      return !t||t.method!==a.method||t.bank_account_id!==a.bank_account_id||
        t.customer_id!==a.customer_id||!positive(Number(a.amount_cents));
    }))return invalid('refund source allocation does not match original tenders');
    const cash=(await db.prepare(
      'SELECT type,debit,credit,payment_method,is_deleted FROM cash_book WHERE reference=?'
    ).bind(returnId).all<any>()).results||[];
    const bank=(await db.prepare(
      'SELECT type,debit,credit,bank_account_id,status,is_deleted '+
      'FROM bank_book WHERE reference=?'
    ).bind(returnId).all<any>()).results||[];
    const credit=(await db.prepare(
      'SELECT entry_type,source_type,delta_cents,customer_id '+
      'FROM customer_store_credit_entries WHERE source_id=?'
    ).bind(returnId).all<any>()).results||[];
    const receivable=await db.prepare(
      'SELECT COUNT(*) n FROM customer_ledger WHERE reference=?'
    ).bind(returnId).first<any>();
    if(Number(receivable?.n)!==0)return invalid('refund incorrectly modified customer receivables');
    const journals:RefundSource[]=[];
    for(const cb of cash){
      if(cb.type!=='Sales Return'||cb.payment_method!=='Cash'||
        Number(cb.is_deleted)!==0||cents(cb.credit)!==0||
        !positive(cents(cb.debit)))return invalid('Cash Book refund journal is invalid');
      journals.push({sourceKey:'Cash',amountCents:cents(cb.debit)});
    }
    for(const bb of bank){
      const source=originalRows.find(a=>a.bank_account_id===bb.bank_account_id&&
        (a.method==='Bank'||a.method==='Mobile Banking'));
      if(!source||bb.type!=='Sales Return'||bb.status!=='Active'||
        Number(bb.is_deleted)!==0||cents(bb.credit)!==0||
        !positive(cents(bb.debit)))
        return invalid('Bank/Mobile refund journal is invalid');
      journals.push({sourceKey:String(source.source_key),amountCents:cents(bb.debit)});
    }
    for(const entry of credit){
      if(entry.entry_type!=='ISSUE'||entry.source_type!=='Sales Return'||
        entry.customer_id!==sale.customer_id||!positive(Number(entry.delta_cents)))
        return invalid('Store Credit liability refund journal is invalid');
      journals.push({sourceKey:'Store Credit',amountCents:Number(entry.delta_cents)});
    }
    history.push({invoiceId,returnId,amountCents:cents(sr.total_return_amount),
      itemsCents,returnedQty,restoredFifoQty,allocations,journals});
  }
  return quoteVerifiedPartialSplitRefund(invoiceId,original,history,requestedCents);
}
