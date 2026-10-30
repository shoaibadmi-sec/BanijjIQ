import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import {quotePartialSplitRefundFromD1} from './partial-refund-d1.js';
import type {RefundSource} from './partial-split-refunds.js';

/**
 * INTERNAL G2-N: strictly Cash+Bank, one original line and one sold FIFO lot.
 * Not wired to a route. Other sources must use their own audited path.
 * All money and stock writes are one D1 batch; final audit is LAST.
 */
export type CashBankPartialInput=Readonly<{
  invoiceId:string;productId:string;quantity:number;requestId:string;reason:string;
}>;
type Result=Readonly<{returnId:string;alreadyPosted:boolean;allocations:readonly RefundSource[]}>;
const cents=(value:unknown):number=>{
  const n=Number(value),c=n*100;
  if(!Number.isFinite(n)||!Number.isSafeInteger(Math.round(c))||
    Math.abs(c-Math.round(c))>0.00001)throw new Error('Original amount must reconcile to integer poisha.');
  return Math.round(c);
};
const fail=(message:string):never=>{throw new Error('Partial refund source conflict: '+message);};

export async function postCashBankPartialSplitReturn(
  db:SherDatabase,input:CashBankPartialInput
):Promise<Result>{
  if(!input||!input.invoiceId||!input.productId||
    !/^[A-Z0-9][A-Z0-9-]{5,45}$/.test(input.requestId||'')||
    !Number.isSafeInteger(input.quantity)||input.quantity<=0||
    typeof input.reason!=='string'||input.reason.trim()!==input.reason||
    input.reason.length<8||input.reason.length>500)
    return fail('Invalid invoice, original item, whole quantity, request ID or reason.');
  const returnId='SRT-'+input.requestId;
  const replay=async():Promise<Result|null>=>{
    const existing=await db.prepare(
      'SELECT return_id,invoice_id,refund_method,reason,total_return_amount FROM sales_returns WHERE return_id=?'
    ).bind(returnId).first<any>();
    if(!existing)return null;
    const items=(await db.prepare(
      'SELECT product_id,return_quantity,line_total FROM sales_return_items WHERE return_id=?'
    ).bind(returnId).all<any>()).results||[];
    const audited=await db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN' AND entity_id=?"
    ).bind(returnId).first<any>();
    if(existing.invoice_id!==input.invoiceId||existing.refund_method!=='Split Partial'||
      existing.reason!==input.reason||items.length!==1||
      items[0].product_id!==input.productId||
      Number(items[0].return_quantity)!==input.quantity||
      cents(items[0].line_total)!==cents(existing.total_return_amount)||
      Number(audited?.n)!==1)
      return fail('Idempotency request reused with different or unverified transaction.');
    const rows=(await db.prepare(
      'SELECT source_key,amount_cents FROM split_partial_refund_allocations WHERE return_id=? ORDER BY source_key'
    ).bind(returnId).all<any>()).results||[];
    if(!rows.length||rows.reduce((sum,r)=>sum+Number(r.amount_cents),0)!==cents(existing.total_return_amount))
      return fail('Idempotency replay has incomplete original-source proof.');
    return {returnId,alreadyPosted:true,allocations:rows.map(r=>({
      sourceKey:String(r.source_key),amountCents:Number(r.amount_cents)
    }))};
  };
  const previous=await replay();
  if(previous)return previous;
  const sale=await db.prepare(
    'SELECT invoice_id,customer_id,customer_name,customer_phone,subtotal,discount,grand_total,'+
    'paid_amount,due_amount,payment_type,payment_method,status,is_deleted FROM sales WHERE invoice_id=?'
  ).bind(input.invoiceId).first<any>();
  if(!sale||sale.status!=='Completed'||Number(sale.is_deleted)!==0||
    sale.payment_type!=='Cash'||sale.payment_method!=='Split'||
    !sale.customer_id||cents(sale.grand_total)<=0||
    cents(sale.grand_total)!==cents(sale.paid_amount)||
    cents(sale.due_amount)!==0||cents(sale.discount)!==0||
    cents(sale.subtotal)!==cents(sale.grand_total))
    return fail('Original split invoice is not an unchanged fully-paid sale.');
  const originals=(await db.prepare(
    'SELECT method,source_key,amount_cents,bank_account_id,customer_id FROM sale_tender_allocations '+
    'WHERE invoice_id=? ORDER BY line_number'
  ).bind(input.invoiceId).all<any>()).results||[];
  if(originals.length!==2||originals[0].method!=='Cash'||
    originals[0].source_key!=='Cash'||originals[0].bank_account_id!==''||
    originals[0].customer_id!==''||originals[1].method!=='Bank'||
    originals[1].source_key!=='Bank:'+originals[1].bank_account_id||
    !originals[1].bank_account_id||originals[1].customer_id!==''||
    originals.some(t=>!Number.isSafeInteger(Number(t.amount_cents))||Number(t.amount_cents)<=0)||
    originals.reduce((n,t)=>n+Number(t.amount_cents),0)!==cents(sale.grand_total))
    return fail('Only exact original Cash+Bank tenders are supported; no Store Credit substitution.');
  const originalCash=(await db.prepare(
    'SELECT type,credit,debit,payment_method,is_deleted FROM cash_book WHERE reference=?'
  ).bind(input.invoiceId).all<any>()).results||[];
  const originalBank=(await db.prepare(
    'SELECT type,credit,debit,bank_account_id,status,is_deleted FROM bank_book WHERE reference=?'
  ).bind(input.invoiceId).all<any>()).results||[];
  if(originalCash.length!==1||originalCash[0].type!=='Sale'||
    originalCash[0].payment_method!=='Cash'||Number(originalCash[0].is_deleted)!==0||
    cents(originalCash[0].credit)!==Number(originals[0].amount_cents)||
    cents(originalCash[0].debit)!==0||
    originalBank.length!==1||originalBank[0].type!=='Sale'||
    originalBank[0].bank_account_id!==originals[1].bank_account_id||
    originalBank[0].status!=='Active'||Number(originalBank[0].is_deleted)!==0||
    cents(originalBank[0].credit)!==Number(originals[1].amount_cents)||
    cents(originalBank[0].debit)!==0)
    return fail('Original Cash or Bank payment source books do not reconcile.');
  const bank=await db.prepare(
    'SELECT bank_account_id,account_name,account_type,status,opening_balance,current_balance '+
    'FROM bank_accounts WHERE bank_account_id=?'
  ).bind(originals[1].bank_account_id).first<any>();
  const net=await db.prepare(
    'SELECT COALESCE(SUM(credit-debit),0) net FROM bank_book '+
    'WHERE bank_account_id=? AND is_deleted=0'
  ).bind(originals[1].bank_account_id).first<any>();
  if(!bank||bank.account_type!=='Bank'||bank.status!=='Active'||
    cents(Number(bank.opening_balance)+Number(net?.net||0))!==cents(bank.current_balance))
    return fail('Original Bank account no longer reconciles to its ledger.');
  const items=(await db.prepare(
    'SELECT product_id,product_name,quantity,unit_price,line_total FROM sale_items WHERE invoice_id=?'
  ).bind(input.invoiceId).all<any>()).results||[];
  if(items.length!==1||items[0].product_id!==input.productId||
    !Number.isSafeInteger(Number(items[0].quantity))||Number(items[0].quantity)<=0||
    cents(items[0].line_total)!==Number(items[0].quantity)*cents(items[0].unit_price)||
    cents(items[0].line_total)!==cents(sale.grand_total))
    return fail('Only one unchanged original product line is supported.');
  const item=items[0];
  const amountCents=input.quantity*cents(item.unit_price);
  const prior=await db.prepare(
    'SELECT COALESCE(SUM(i.return_quantity),0) qty FROM sales_return_items i '+
    'WHERE i.invoice_id=? AND i.product_id=?'
  ).bind(input.invoiceId,input.productId).first<any>();
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||
    input.quantity+Number(prior?.qty||0)>Number(item.quantity))
    return fail('Return quantity exceeds remaining originally sold units.');
  const otherReturns=(await db.prepare(
    'SELECT return_id,refund_method FROM sales_returns WHERE invoice_id=?'
  ).bind(input.invoiceId).all<any>()).results||[];
  if(otherReturns.some(r=>r.refund_method!=='Split Partial'))
    return fail('Invoice already has a non-partial return or reversal.');
  for(const ret of otherReturns){
    const proof=await db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='POST_PARTIAL_SPLIT_RETURN' AND entity_id=?"
    ).bind(ret.return_id).first<any>();
    if(Number(proof?.n)!==1)return fail('Unsealed historical partial refund cannot be trusted.');
  }
  const unsupported=await Promise.all([
    db.prepare('SELECT 1 x FROM sale_item_unit_snapshots WHERE invoice_id=? LIMIT 1').bind(input.invoiceId).first(),
    db.prepare('SELECT 1 x FROM vendor_sourcing WHERE invoice_id=? LIMIT 1').bind(input.invoiceId).first(),
    db.prepare('SELECT 1 x FROM sale_reversal_logs WHERE invoice_id=? LIMIT 1').bind(input.invoiceId).first()
  ]);
  if(unsupported.some(Boolean))return fail('Mixed units, vendor sourcing or reversals are not supported.');
  const product=await db.prepare(
    'SELECT current_stock,track_serial,track_expiry,track_warranty,status,is_deleted FROM products WHERE product_id=?'
  ).bind(input.productId).first<any>();
  const lots=(await db.prepare(
    'SELECT il.lot_id,il.quantity sold,sl.original_quantity,sl.remaining_quantity,sl.source_type '+
    'FROM sale_item_lots il JOIN stock_lots sl ON sl.lot_id=il.lot_id '+
    'WHERE il.invoice_id=? AND il.product_id=?'
  ).bind(input.invoiceId,input.productId).all<any>()).results||[];
  if(!product||Number(product.is_deleted)!==0||product.status==='Inactive'||
    product.track_serial||product.track_expiry||product.track_warranty||
    lots.length!==1||Number(lots[0].sold)!==Number(item.quantity)||
    lots[0].source_type==='OVERSOLD'||Number(lots[0].remaining_quantity)<0||
    Number(lots[0].remaining_quantity)+input.quantity>Number(lots[0].original_quantity))
    return fail('Tracked, negative-stock, missing or full original FIFO lot is unsupported.');
  const allocation=await quotePartialSplitRefundFromD1(db,input.invoiceId,amountCents);
  if(allocation.some(a=>!['Cash',originals[1].source_key].includes(a.sourceKey))||
    allocation.reduce((n,a)=>n+a.amountCents,0)!==amountCents)
    return fail('Refund allocation contains an unverified original payment source.');
  const amountBank=allocation.find(a=>a.sourceKey===originals[1].source_key)?.amountCents||0;
  if(cents(bank.current_balance)<amountBank)
    return fail('Original Bank account has insufficient money to refund.');
  const date=new Date().toISOString().slice(0,10);
  const stmts:SqlPreparedStatement[]=[
    db.prepare(
      'INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,'+
      'customer_phone,refund_method,total_return_amount,reason,notes,processed_by) '+
      'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(returnId,date,input.invoiceId,sale.customer_id,sale.customer_name,
      sale.customer_phone,'Split Partial',amountCents/100,input.reason,'Original Cash+Bank sources','Internal G2-N')
  ];
  stmts.push(db.prepare(
    'INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) '+
    'VALUES (?,?,?,?,?,?,?)'
  ).bind(returnId,input.invoiceId,input.productId,item.product_name,input.quantity,
    Number(item.unit_price),amountCents/100));
  stmts.push(db.prepare(
    'INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,?,?,?,?)'
  ).bind(returnId,input.invoiceId,input.productId,lots[0].lot_id,input.quantity));
  stmts.push(db.prepare(
    'INSERT INTO split_refund_lot_restorations(return_id,invoice_id,lot_id,product_id,quantity,prior_remaining) '+
    'VALUES (?,?,?,?,?,?)'
  ).bind(returnId,input.invoiceId,lots[0].lot_id,input.productId,input.quantity,
    Number(lots[0].remaining_quantity)));
  stmts.push(db.prepare(
    "UPDATE stock_lots SET remaining_quantity=remaining_quantity+?,status='Active',updated_at=datetime('now') "+
    "WHERE lot_id=? AND remaining_quantity+?<=original_quantity AND source_type<>'OVERSOLD'"
  ).bind(input.quantity,lots[0].lot_id,input.quantity));
  stmts.push(db.prepare(
    "UPDATE products SET current_stock=current_stock+?,updated_at=datetime('now') WHERE product_id=?"
  ).bind(input.quantity,input.productId));
  stmts.push(db.prepare(
    "INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) "+
    "VALUES (?,?,'Sales Return',?,0,?,?,NULL)"
  ).bind('SM-'+crypto.randomUUID().slice(0,12).toUpperCase(),
    input.productId,input.quantity,Number(product.current_stock)+input.quantity,returnId));
  for(const a of allocation){
    const isCash=a.sourceKey==='Cash';
    stmts.push(db.prepare(
      'INSERT INTO split_partial_refund_allocations(allocation_id,return_id,invoice_id,method,amount_cents,'+
      'bank_account_id,customer_id,source_key) VALUES (?,?,?,?,?,?,?,?)'
    ).bind('PA-'+crypto.randomUUID().slice(0,12).toUpperCase(),returnId,input.invoiceId,
      isCash?'Cash':'Bank',a.amountCents,isCash?'':bank.bank_account_id,'',a.sourceKey));
    if(isCash){
      stmts.push(db.prepare(
        "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
        "VALUES (?,?,'Sales Return',?,?,?,0,'Cash',0)"
      ).bind('CB-'+crypto.randomUUID().slice(0,12).toUpperCase(),
        date,returnId,'Exact partial Cash refund of '+input.invoiceId,a.amountCents/100));
    }else{
      stmts.push(db.prepare(
        'UPDATE bank_accounts SET current_balance=current_balance-? '+
        "WHERE bank_account_id=? AND status='Active' AND account_type='Bank' AND current_balance>=?"
      ).bind(a.amountCents/100,bank.bank_account_id,a.amountCents/100));
      stmts.push(db.prepare(
        "INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,"+
        "debit,credit,balance,status,notes,reversal_of,created_by,is_deleted) "+
        "VALUES (?,?,?,?,'Sales Return',?,?,?,0,(SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),"+
        "'Active',?,?,?,0)"
      ).bind('BB-'+crypto.randomUUID().slice(0,12).toUpperCase(),bank.bank_account_id,bank.account_name,
        date,returnId,'Exact partial Bank refund for '+input.invoiceId,
        a.amountCents/100,bank.bank_account_id,input.reason,input.invoiceId,'Internal G2-N'));
    }
  }
  // Authoritative seal runs after ALL provisional rows, so D1 rolls back every
  // cash/bank/stock write if any 0050 source or FIFO condition fails.
  stmts.push(db.prepare(
    "INSERT INTO audit_logs(action,entity_type,entity_id,note) "+
    "VALUES ('POST_PARTIAL_SPLIT_RETURN','SALES_RETURN',?,?)"
  ).bind(returnId,'Original Cash+Bank partial refund, '+amountCents+' poisha'));
  try{await db.batch(stmts);}catch(e){
    const raced=await replay();
    if(raced)return raced;
    throw new Error('Partial refund batch failed and rolled back: '+String(e));
  }
  return {returnId,alreadyPosted:false,allocations:allocation};
}
