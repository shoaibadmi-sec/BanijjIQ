import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import {quotePartialSplitRefundFromD1} from './partial-refund-d1.js';
import type {RefundSource} from './partial-split-refunds.js';

/**
 * G2-Q internal-only Cash+Store Credit partial return.
 * Not registered in Hono. One untracked product, one original FIFO lot,
 * exact original Cash+Store Credit tenders; never substitute bank or cash
 * for Store Credit liability. The D1 audit MUST be the final batch row.
 */
export type CashCreditPartialInput=Readonly<{
  invoiceId:string;productId:string;quantity:number;requestId:string;reason:string;
}>;
type Result=Readonly<{
  returnId:string;alreadyPosted:boolean;allocations:readonly RefundSource[];
}>;
const cents=(value:unknown):number=>{
  const n=Number(value),c=n*100;
  if(!Number.isFinite(n)||!Number.isSafeInteger(Math.round(c))||
    Math.abs(c-Math.round(c))>0.00001)throw new Error('Financial amount is not integer poisha.');
  return Math.round(c);
};
const reject=(reason:string):never=>{throw new Error('Partial Cash+Credit source conflict: '+reason);};

export async function postCashCreditPartialSplitReturn(
  db:SherDatabase,input:CashCreditPartialInput
):Promise<Result>{
  if(!input||!input.invoiceId||!input.productId||
    !/^[A-Z0-9][A-Z0-9-]{5,45}$/.test(input.requestId||'')||
    !Number.isSafeInteger(input.quantity)||input.quantity<=0||
    typeof input.reason!=='string'||input.reason.trim()!==input.reason||
    input.reason.length<8||input.reason.length>500)
    return reject('Invalid invoice, product, quantity, idempotency ID or reason.');
  const returnId='SRT-'+input.requestId;
  const fetchRows=async(query:string,...args:unknown[]):Promise<any[]> =>
    (await db.prepare(query).bind(...args).all<any>()).results||[];

  const replay=async():Promise<Result|null>=>{
    const old=await db.prepare(
      'SELECT return_id,invoice_id,customer_id,refund_method,reason,total_return_amount '+
      'FROM sales_returns WHERE return_id=?'
    ).bind(returnId).first<any>();
    if(!old)return null;
    const [items,allocations,cash,issue,movements,fifo,snapshots,originalSale,audit,receivable]=await Promise.all([
      fetchRows('SELECT product_id,invoice_id,return_quantity,line_total FROM sales_return_items WHERE return_id=?',returnId),
      fetchRows('SELECT method,source_key,amount_cents,customer_id FROM split_partial_refund_allocations WHERE return_id=?',returnId),
      fetchRows('SELECT type,payment_method,debit,credit,is_deleted FROM cash_book WHERE reference=?',returnId),
      fetchRows('SELECT entry_type,source_type,source_id,customer_id,delta_cents FROM customer_store_credit_entries WHERE source_id=?',returnId),
      fetchRows('SELECT product_id,movement_type,quantity_in,quantity_out FROM stock_movements WHERE note=?',returnId),
      fetchRows('SELECT invoice_id,product_id,lot_id,quantity FROM sales_return_item_lots WHERE return_id=?',returnId),
      fetchRows('SELECT invoice_id,product_id,lot_id,quantity FROM split_refund_lot_restorations WHERE return_id=?',returnId),
      db.prepare('SELECT customer_id FROM sales WHERE invoice_id=?').bind(input.invoiceId).first<any>(),
      db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN' AND entity_id=?").bind(returnId).first<any>(),
      db.prepare('SELECT COUNT(*) n FROM customer_ledger WHERE reference=?').bind(returnId).first<any>()
    ]);
    const cashRefund=allocations.find(x=>x.method==='Cash');
    const creditRefund=allocations.find(x=>x.method==='Store Credit');
    if(old.invoice_id!==input.invoiceId||old.refund_method!=='Split Partial'||
      old.reason!==input.reason||items.length!==1||
      items[0].product_id!==input.productId||items[0].invoice_id!==input.invoiceId||
      Number(items[0].return_quantity)!==input.quantity||
      cents(items[0].line_total)!==cents(old.total_return_amount)||
      allocations.length!==2||!cashRefund||!creditRefund||
      cashRefund.source_key!=='Cash'||creditRefund.source_key!=='Store Credit'||
      creditRefund.customer_id!==old.customer_id||
      allocations.reduce((n,a)=>n+Number(a.amount_cents),0)!==cents(old.total_return_amount)||
      Number(audit?.n)!==1||Number(receivable?.n)!==0||
      cash.length!==1||cash[0].type!=='Sales Return'||
      cash[0].payment_method!=='Cash'||Number(cash[0].is_deleted)!==0||
      cents(cash[0].debit)!==Number(cashRefund.amount_cents)||cents(cash[0].credit)!==0||
      issue.length!==1||issue[0].entry_type!=='ISSUE'||
      issue[0].source_type!=='Sales Return'||issue[0].customer_id!==originalSale?.customer_id||
      Number(issue[0].delta_cents)!==Number(creditRefund.amount_cents)||
      movements.length!==1||movements[0].product_id!==input.productId||
      movements[0].movement_type!=='Sales Return'||
      Number(movements[0].quantity_in)!==input.quantity||Number(movements[0].quantity_out)!==0||
      fifo.length!==1||snapshots.length!==1||fifo[0].invoice_id!==input.invoiceId||
      fifo[0].product_id!==input.productId||Number(fifo[0].quantity)!==input.quantity||
      snapshots[0].invoice_id!==input.invoiceId||snapshots[0].product_id!==input.productId||
      snapshots[0].lot_id!==fifo[0].lot_id||Number(snapshots[0].quantity)!==input.quantity)
      return reject('Idempotency replay or its Cash, Store Credit and FIFO journals do not reconcile.');
    return {returnId,alreadyPosted:true,allocations:[
      {sourceKey:'Cash',amountCents:Number(cashRefund.amount_cents)},
      {sourceKey:'Store Credit',amountCents:Number(creditRefund.amount_cents)}
    ]};
  };
  const previous=await replay();
  if(previous)return previous;

  const sale=await db.prepare(
    'SELECT customer_id,customer_name,customer_phone,subtotal,discount,grand_total,'+
    'paid_amount,due_amount,payment_type,payment_method,status,is_deleted FROM sales WHERE invoice_id=?'
  ).bind(input.invoiceId).first<any>();
  const customer=sale?.customer_id?await db.prepare(
    'SELECT customer_id,phone,current_due,status,is_deleted FROM customers WHERE customer_id=?'
  ).bind(sale.customer_id).first<any>():null;
  if(!sale||sale.status!=='Completed'||Number(sale.is_deleted)!==0||
    sale.payment_type!=='Cash'||sale.payment_method!=='Split'||
    cents(sale.paid_amount)!==cents(sale.grand_total)||cents(sale.due_amount)!==0||
    cents(sale.subtotal)!==cents(sale.grand_total)||cents(sale.discount)!==0||
    !customer||customer.status!=='Active'||Number(customer.is_deleted)!==0||
    customer.phone!==sale.customer_phone||Number(customer.current_due)<0)
    return reject('Only a fully paid unchanged split sale with an active customer is supported.');
  const originals=await fetchRows(
    'SELECT method,source_key,amount_cents,bank_account_id,customer_id '+
    'FROM sale_tender_allocations WHERE invoice_id=? ORDER BY line_number',input.invoiceId);
  if(originals.length!==2||
    originals[0].method!=='Cash'||originals[0].source_key!=='Cash'||
    originals[0].customer_id!==''||originals[0].bank_account_id!==''||
    originals[1].method!=='Store Credit'||originals[1].source_key!=='Store Credit'||
    originals[1].customer_id!==sale.customer_id||originals[1].bank_account_id!==''||
    originals.some(x=>!Number.isSafeInteger(Number(x.amount_cents))||Number(x.amount_cents)<=0)||
    originals.reduce((n,x)=>n+Number(x.amount_cents),0)!==cents(sale.grand_total))
    return reject('Original tender must be exactly Cash then redeemed Store Credit.');
  const originalCash=await fetchRows(
    'SELECT type,payment_method,debit,credit,is_deleted FROM cash_book WHERE reference=?',input.invoiceId);
  const originalRedeem=await fetchRows(
    "SELECT entry_type,customer_id,delta_cents FROM customer_store_credit_entries WHERE source_type='Sale' AND source_id=?",input.invoiceId);
  if(originalCash.length!==1||originalCash[0].type!=='Sale'||
    originalCash[0].payment_method!=='Cash'||Number(originalCash[0].is_deleted)!==0||
    cents(originalCash[0].debit)!==0||cents(originalCash[0].credit)!==Number(originals[0].amount_cents)||
    originalRedeem.length!==1||originalRedeem[0].entry_type!=='REDEEM'||
    originalRedeem[0].customer_id!==sale.customer_id||
    Number(originalRedeem[0].delta_cents)!==-Number(originals[1].amount_cents))
    return reject('Original Cash receipt and Store Credit redemption must reconcile exactly.');
  const [creditBalance,legacy,receivable]=await Promise.all([
    db.prepare('SELECT available_cents FROM customer_store_credit_balance WHERE customer_id=?').bind(sale.customer_id).first<any>(),
    db.prepare('SELECT COUNT(*) n FROM store_credit_legacy_unreconciled legacy JOIN sales_returns sr ON sr.return_id=legacy.return_id WHERE sr.customer_id=? OR sr.customer_phone=?')
      .bind(sale.customer_id,sale.customer_phone).first<any>(),
    db.prepare("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id=? AND type='Sales Return Credit'")
      .bind(sale.customer_id).first<any>()
  ]);
  if(!creditBalance||!Number.isSafeInteger(Number(creditBalance.available_cents))||
    Number(creditBalance.available_cents)<0||Number(legacy?.n)>0||Number(receivable?.n)>0)
    return reject('Store Credit liability is unreconciled or has legacy customer debt.');
  const items=await fetchRows(
    'SELECT product_id,product_name,quantity,unit_price,line_total FROM sale_items WHERE invoice_id=?',input.invoiceId);
  if(items.length!==1||items[0].product_id!==input.productId||
    !Number.isSafeInteger(Number(items[0].quantity))||Number(items[0].quantity)<=0||
    cents(items[0].line_total)!==Number(items[0].quantity)*cents(items[0].unit_price)||
    cents(items[0].line_total)!==cents(sale.grand_total))
    return reject('Only a single original, unchanged product line is supported.');
  const item=items[0];
  const amountCents=input.quantity*cents(item.unit_price);
  const prior=await db.prepare(
    'SELECT COALESCE(SUM(return_quantity),0) qty FROM sales_return_items WHERE invoice_id=? AND product_id=?'
  ).bind(input.invoiceId,input.productId).first<any>();
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||
    Number(prior?.qty||0)+input.quantity>Number(item.quantity))
    return reject('Requested quantity exceeds originally sold items.');
  const historical=await fetchRows(
    'SELECT return_id,refund_method FROM sales_returns WHERE invoice_id=?',input.invoiceId);
  for(const row of historical){
    const proof=await db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN' AND entity_id=?"
    ).bind(row.return_id).first<any>();
    if(row.refund_method!=='Split Partial'||Number(proof?.n)!==1)
      return reject('Invoice has an unaudited, full or incompatible previous refund.');
  }
  const disallowed=await Promise.all([
    db.prepare('SELECT 1 x FROM sale_item_unit_snapshots WHERE invoice_id=? LIMIT 1').bind(input.invoiceId).first(),
    db.prepare('SELECT 1 x FROM vendor_sourcing WHERE invoice_id=? LIMIT 1').bind(input.invoiceId).first(),
    db.prepare('SELECT 1 x FROM sale_reversal_logs WHERE invoice_id=? LIMIT 1').bind(input.invoiceId).first()
  ]);
  if(disallowed.some(Boolean))return reject('Mixed-unit, vendor-sourced or reversed sale is unsupported.');
  const product=await db.prepare(
    'SELECT current_stock,track_serial,track_expiry,track_warranty,status,is_deleted FROM products WHERE product_id=?'
  ).bind(input.productId).first<any>();
  const lots=await fetchRows(
    'SELECT sold.lot_id,sold.quantity sold,stock.original_quantity,stock.remaining_quantity,stock.source_type '+
    'FROM sale_item_lots sold JOIN stock_lots stock ON stock.lot_id=sold.lot_id '+
    'WHERE sold.invoice_id=? AND sold.product_id=?',input.invoiceId,input.productId);
  if(!product||Number(product.is_deleted)!==0||product.status==='Inactive'||
    Number(product.track_serial)!==0||Number(product.track_expiry)!==0||
    Number(product.track_warranty)!==0||lots.length!==1||
    Number(lots[0].sold)!==Number(item.quantity)||lots[0].source_type==='OVERSOLD'||
    Number(lots[0].remaining_quantity)<0||
    Number(lots[0].remaining_quantity)+input.quantity>Number(lots[0].original_quantity))
    return reject('Tracked, oversold, missing or exhausted original FIFO lot is unsupported.');
  const allocation=await quotePartialSplitRefundFromD1(db,input.invoiceId,amountCents);
  const cashCents=allocation.find(x=>x.sourceKey==='Cash')?.amountCents||0;
  const creditCents=allocation.find(x=>x.sourceKey==='Store Credit')?.amountCents||0;
  if(allocation.length!==2||cashCents<=0||creditCents<=0||
    cashCents+creditCents!==amountCents)
    return reject('This slice requires positive exact Cash and Store Credit source refunds.');
  const date=new Date().toISOString().slice(0,10);
  const stmts:SqlPreparedStatement[]=[
    db.prepare(
      'INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,'+
      'customer_phone,refund_method,total_return_amount,reason,notes,processed_by) '+
      'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(returnId,date,input.invoiceId,sale.customer_id,sale.customer_name,
      sale.customer_phone,'Split Partial',amountCents/100,input.reason,
      'Exact Cash + Store Credit partial return','Internal G2-Q'),
    db.prepare(
      'INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) '+
      'VALUES (?,?,?,?,?,?,?)'
    ).bind(returnId,input.invoiceId,input.productId,item.product_name,input.quantity,
      Number(item.unit_price),amountCents/100),
    db.prepare(
      'INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,?,?,?,?)'
    ).bind(returnId,input.invoiceId,input.productId,lots[0].lot_id,input.quantity),
    db.prepare(
      'INSERT INTO split_refund_lot_restorations(return_id,invoice_id,lot_id,product_id,quantity,prior_remaining) '+
      'VALUES (?,?,?,?,?,?)'
    ).bind(returnId,input.invoiceId,lots[0].lot_id,input.productId,input.quantity,
      Number(lots[0].remaining_quantity)),
    db.prepare(
      "UPDATE stock_lots SET remaining_quantity=remaining_quantity+?,status='Active',updated_at=datetime('now') "+
      "WHERE lot_id=? AND remaining_quantity+?<=original_quantity AND source_type<>'OVERSOLD'"
    ).bind(input.quantity,lots[0].lot_id,input.quantity),
    db.prepare(
      "UPDATE products SET current_stock=current_stock+?,updated_at=datetime('now') WHERE product_id=?"
    ).bind(input.quantity,input.productId),
    db.prepare(
      "INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) "+
      "VALUES (?,?,'Sales Return',?,0,?,?,NULL)"
    ).bind('SM-'+crypto.randomUUID().slice(0,12).toUpperCase(),
      input.productId,input.quantity,Number(product.current_stock)+input.quantity,returnId)
  ];
  for(const a of allocation){
    stmts.push(db.prepare(
      'INSERT INTO split_partial_refund_allocations(allocation_id,return_id,invoice_id,'+
      'method,amount_cents,bank_account_id,customer_id,source_key) VALUES (?,?,?,?,?,?,?,?)'
    ).bind('PA-'+crypto.randomUUID().slice(0,12).toUpperCase(),returnId,input.invoiceId,
      a.sourceKey==='Cash'?'Cash':'Store Credit',a.amountCents,'',
      a.sourceKey==='Cash'?'':sale.customer_id,a.sourceKey));
  }
  stmts.push(db.prepare(
    "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
    "VALUES (?,?,'Sales Return',?,?,?,0,'Cash',0)"
  ).bind('CB-'+crypto.randomUUID().slice(0,12).toUpperCase(),date,returnId,
    'Original Cash source refund of '+input.invoiceId,cashCents/100));
  stmts.push(db.prepare(
    "INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,"+
    "delta_cents,balance_after_cents,note,created_by) "+
    "VALUES (?,?,'ISSUE','Sales Return',?,?,?,?,?)"
  ).bind('CI-'+crypto.randomUUID().slice(0,12).toUpperCase(),sale.customer_id,returnId,
    creditCents,Number(creditBalance.available_cents)+creditCents,
    'Exact original Store Credit source reissue of '+input.invoiceId,'Internal G2-Q'));
  // The immutable 0050 final-audit proof is the *last* D1 batch statement.
  stmts.push(db.prepare(
    "INSERT INTO audit_logs(action,entity_type,entity_id,note) "+
    "VALUES ('POST_PARTIAL_SPLIT_RETURN','SALES_RETURN',?,?)"
  ).bind(returnId,'Cash '+cashCents+' and Store Credit '+creditCents+' poisha'));
  try{await db.batch(stmts);}catch(error){
    const committed=await replay();
    if(committed)return committed;
    throw new Error('Cash+Credit refund batch failed and rolled back: '+String(error));
  }
  return {returnId,alreadyPosted:false,allocations:allocation};
}
