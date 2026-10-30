import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import {hasModulePermission} from '../auth/permissions.js';

type Source = {
  method:'Cash'|'Bank'|'Mobile Banking'|'Store Credit';
  amountCents:number;
  bankAccountId:string;
  sourceKey:string;
};
const cents=(value:unknown)=>{
  const n=Number(value);
  return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*100))&&
    Math.abs(n*100-Math.round(n*100))<0.00001?Math.round(n*100):null;
};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8'}
});

/**
 * Phase G2-H Task 1. Read-only preflight, not refund authorization.
 * Reuses immutable 0045 allocations and their real source journals.
 * Any missing evidence blocks ALL refunds; never substitute cash.
 */
export async function getSplitSaleReversalPreviewRoute(db:SherDatabase,id:string):Promise<Response>{
  const sale=await db.prepare('SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0')
    .bind(id).first<any>();
  if(!sale)return respond({ok:false,error:'Invoice not found.'},404);
  const blocked=(reason:string)=>respond({ok:true,preview:{
    eligible:false,reason,invoiceId:id,totalCents:cents(sale.grand_total)||0,
    refundCents:0,creditReissueCents:0,allocations:[]
  }});
  if(sale.status!=='Completed'||sale.payment_method!=='Split')
    return blocked('Only a completed split-funded invoice can use this reversal workflow.');
  const open=await db.prepare("SELECT opened_at FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1")
    .first<{opened_at:string}>();
  if(!open||String(sale.created_at||'')<String(open.opened_at||''))
    return blocked('Only invoices posted in the current open cash session can be reversed.');
  const totalCents=cents(sale.grand_total);
  if(!totalCents||totalCents<=0||cents(sale.paid_amount)!==totalCents||
    cents(sale.due_amount)!==0||sale.payment_type!=='Cash'||sale.bank_account_id)
    return blocked('Split sale total and fully paid status cannot be reconciled.');
  // Mirror the POST's supported source contract before the cashier confirms.
  // The POST still rechecks these facts independently before posting money.
  const originalLines=(await db.prepare(
    'SELECT product_id,quantity,unit_price,line_total FROM sale_items WHERE invoice_id=?'
  ).bind(id).all<any>()).results||[];
  if(cents(sale.discount)!==0||cents(sale.subtotal)!==totalCents||
    !originalLines.length||
    new Set(originalLines.map(i=>String(i.product_id))).size!==originalLines.length||
    originalLines.some(i=>!Number.isSafeInteger(Number(i.quantity))||Number(i.quantity)<=0||
      cents(i.line_total)!==cents(Number(i.quantity)*Number(i.unit_price)))||
    originalLines.reduce((sum,i)=>sum+(cents(i.line_total)||0),0)!==totalCents)
    return blocked('Original invoice discount, quantities or line prices do not reconcile.');
  if(await db.prepare('SELECT 1 x FROM sale_item_unit_snapshots WHERE invoice_id=? LIMIT 1')
      .bind(id).first())
    return blocked('Mixed-unit split refunds need original unit-denomination restoration.');
  if(await db.prepare('SELECT 1 x FROM sales_returns WHERE invoice_id=? LIMIT 1').bind(id).first()||
     await db.prepare('SELECT 1 x FROM sale_reversal_logs WHERE invoice_id=? LIMIT 1').bind(id).first())
    return blocked('This invoice already has a return or reversal; do not refund again.');
  if(await db.prepare('SELECT 1 x FROM vendor_sourcing WHERE invoice_id=? LIMIT 1').bind(id).first()||
     await db.prepare(
       'SELECT 1 x FROM sale_items si JOIN products p ON p.product_id=si.product_id '+
       'WHERE si.invoice_id=? AND (p.track_serial=1 OR p.track_expiry=1 OR p.track_warranty=1) LIMIT 1'
     ).bind(id).first()||
     await db.prepare(
       "SELECT 1 x FROM sale_item_lots il JOIN stock_lots lot ON lot.lot_id=il.lot_id "+
       "WHERE il.invoice_id=? AND lot.source_type='OVERSOLD' LIMIT 1"
     ).bind(id).first())
    return blocked('Tracked, vendor-sourced or negative-stock returns need specialist accounting.');
  // The original FIFO quantity and current lot must still be identifiable.
  const lots=await db.prepare(
    'SELECT si.product_id,si.quantity sold,COALESCE(SUM(il.quantity),0) lot_qty '+
    'FROM sale_items si LEFT JOIN sale_item_lots il ON il.invoice_id=si.invoice_id '+
    'AND il.product_id=si.product_id WHERE si.invoice_id=? GROUP BY si.id'
  ).bind(id).all<any>();
  if(!lots.results?.length||lots.results.some(row=>
    !Number.isSafeInteger(Number(row.sold))||Number(row.sold)<=0||
    Number(row.lot_qty)!==Number(row.sold)))
    return blocked('Original FIFO stock lot allocations are incomplete.');
  const a=await db.prepare(
    'SELECT method,amount_cents,bank_account_id,customer_id,source_key '+
    'FROM sale_tender_allocations WHERE invoice_id=? ORDER BY line_number'
  ).bind(id).all<any>();
  const rows=a.results||[];
  if(rows.length<2||rows.length>8||rows.some(row=>!Number.isSafeInteger(Number(row.amount_cents))||
      Number(row.amount_cents)<=0)||
    rows.reduce((sum,row)=>sum+Number(row.amount_cents),0)!==totalCents)
    return blocked('Immutable source allocations do not equal the invoice total.');
  const allocations:Source[]=rows.map(row=>({
    method:row.method,amountCents:Number(row.amount_cents),
    bankAccountId:row.bank_account_id||'',sourceKey:row.source_key
  }));
  let refundCents=0,creditReissueCents=0,expectedCash=0,expectedBank=0;
  for(const row of rows){
    const amount=Number(row.amount_cents);
    if(row.method==='Cash'){
      expectedCash++;refundCents+=amount;
      const booked=await db.prepare(
        "SELECT COUNT(*) n,COALESCE(SUM(credit),0) amount,COALESCE(SUM(debit),0) debit "+
        "FROM cash_book WHERE reference=? AND type='Sale' AND is_deleted=0"
      ).bind(id).first<any>();
      if(Number(booked?.n)!==1||cents(booked?.amount)!==amount||cents(booked?.debit)!==0)
        return blocked('Original cash receipt does not match its source allocation.');
    }else if(row.method==='Bank'||row.method==='Mobile Banking'){
      expectedBank++;refundCents+=amount;
      const bank=await db.prepare(
        'SELECT bank_account_id,account_type,status,opening_balance,current_balance '+
        'FROM bank_accounts WHERE bank_account_id=?'
      ).bind(row.bank_account_id).first<any>();
      if(!bank||bank.status!=='Active'||bank.account_type!==row.method)
        return blocked('Original bank or mobile account is unavailable or has changed type.');
      const book=await db.prepare(
        "SELECT COUNT(*) n,COALESCE(SUM(credit),0) credit,COALESCE(SUM(debit),0) debit "+
        "FROM bank_book WHERE reference=? AND type='Sale' AND bank_account_id=? "+
        "AND is_deleted=0 AND status='Active'"
      ).bind(id,row.bank_account_id).first<any>();
      if(Number(book?.n)!==1||cents(book.credit)!==amount||cents(book.debit)!==0)
        return blocked('Original bank/mobile settlement does not match its source allocation.');
      const net=await db.prepare(
        'SELECT COALESCE(SUM(credit-debit),0) delta FROM bank_book WHERE bank_account_id=? AND is_deleted=0'
      ).bind(row.bank_account_id).first<any>();
      if(cents(Number(bank.opening_balance||0)+Number(net?.delta||0))!==cents(bank.current_balance))
        return blocked('Original bank/mobile account balance and ledger disagree.');
    }else if(row.method==='Store Credit'){
      creditReissueCents+=amount;
      if(!sale.customer_id||row.customer_id!==sale.customer_id)
        return blocked('Store Credit customer is not linked to the original sale.');
      const owner=await db.prepare(
        'SELECT customer_id,phone,status,is_deleted FROM customers WHERE customer_id=?'
      ).bind(row.customer_id).first<any>();
      if(!owner||owner.status!=='Active'||Number(owner.is_deleted)!==0||
        owner.phone!==sale.customer_phone)
        return blocked('Original Store Credit owner is inactive or mismatched.');
      const entry=await db.prepare(
        "SELECT COUNT(*) n,COALESCE(SUM(delta_cents),0) delta "+
        "FROM customer_store_credit_entries WHERE source_type='Sale' AND source_id=? "+
        "AND entry_type='REDEEM' AND customer_id=?"
      ).bind(id,row.customer_id).first<any>();
      if(Number(entry?.n)!==1||Number(entry.delta)!==-amount)
        return blocked('Original Store Credit redemption does not reconcile.');
    }else return blocked('Unrecognized payment source.');
  }
  const [cash,bank,credit,customerLedger]=await Promise.all([
    db.prepare("SELECT COUNT(*) n FROM cash_book WHERE reference=? AND is_deleted=0").bind(id).first<any>(),
    db.prepare("SELECT COUNT(*) n FROM bank_book WHERE reference=? AND is_deleted=0").bind(id).first<any>(),
    db.prepare(
      "SELECT COUNT(*) n FROM customer_store_credit_entries WHERE source_id=? AND source_type='Sale'"
    ).bind(id).first<any>(),
    db.prepare('SELECT COUNT(*) n FROM customer_ledger WHERE reference=?').bind(id).first<any>()
  ]);
  if(Number(cash?.n)!==expectedCash||Number(bank?.n)!==expectedBank||
    Number(credit?.n)!==(creditReissueCents>0?1:0)||Number(customerLedger?.n)!==0)
    return blocked('Unexplained or duplicate payment-source ledger entries were found.');
  return respond({ok:true,preview:{
    eligible:true,reason:'',invoiceId:id,totalCents,refundCents,
    creditReissueCents,allocations
  }});
}


/** Full original-source refund and credit reissue. No partial, discounted,
 * tracked, vendor, negative-stock or mixed-unit reversal until separately audited. */
export async function postSplitSaleReversalRoute(
  db:SherDatabase,id:string,input:{reason?:string},user:AuthUser
):Promise<Response>{
  if(!(await hasModulePermission(db,user,'returns','add')))
    return respond({ok:false,error:'Sales Return permission required.'},403);
  // This endpoint always refunds the ENTIRE invoice. Ignore no unknown body
  // fields: a client requesting one item must never silently refund everything.
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(key=>key!=='reason'))
    return respond({ok:false,error:'Full split refund accepts only a reason; partial refunds are not enabled.'},400);
  const reason=String(input.reason||'').trim();
  if(reason.length<8||reason.length>500)
    return respond({ok:false,error:'Give an 8–500 character refund reason.'},400);
  const preview=await (await getSplitSaleReversalPreviewRoute(db,id)).json() as any;
  if(!preview.ok||!preview.preview?.eligible)
    return respond({ok:false,error:preview.preview?.reason||'Original payment sources cannot be reconciled.'},409);
  const original=await db.prepare(
    'SELECT invoice_id,customer_id,customer_name,customer_phone,grand_total,subtotal,discount,sale_date '+
    'FROM sales WHERE invoice_id=? AND status=? AND is_deleted=0'
  ).bind(id,'Completed').first<any>();
  if(!original)return respond({ok:false,error:'Original invoice no longer qualifies.'},409);
  const rows=await db.prepare(
    'SELECT product_id,product_name,quantity,unit_price,line_total FROM sale_items WHERE invoice_id=? ORDER BY id'
  ).bind(id).all<any>();
  const items=rows.results||[];
  const total=Number(preview.preview.totalCents);
  if(!items.length||cents(original.grand_total)!==total||
    cents(original.discount)!==0||cents(original.subtotal)!==total||
    new Set(items.map(i=>String(i.product_id))).size!==items.length||
    items.some(i=>!Number.isSafeInteger(Number(i.quantity))||Number(i.quantity)<=0||
      cents(i.line_total)!==cents(Number(i.quantity)*Number(i.unit_price)))||
    items.reduce((sum,i)=>sum+(cents(i.line_total)||0),0)!==total)
    return respond({ok:false,error:'This refund requires unmodified original line prices and zero discount.'},409);
  if(await db.prepare(
    'SELECT 1 x FROM sale_item_unit_snapshots WHERE invoice_id=? LIMIT 1'
  ).bind(id).first())
    return respond({ok:false,error:'Mixed-unit refunds need original unit-denomination restoration.'},409);

  const allocations=preview.preview.allocations as Source[];
  const creditAmount=Number(preview.preview.creditReissueCents);
  const credit=creditAmount>0?await db.prepare(
    'SELECT available_cents FROM customer_store_credit_balance WHERE customer_id=?'
  ).bind(original.customer_id).first<{available_cents:number}>():null;
  if(creditAmount>0&&(!credit||!Number.isSafeInteger(Number(credit.available_cents))||
    Number(credit.available_cents)<0))
    return respond({ok:false,error:'Store Credit balance changed; review before refund.'},409);
  const restored=new Map<string,{qty:number;productId:string;original:number;balance:number;type:string}>();
  const lots=await db.prepare(
    'SELECT il.lot_id,il.product_id,il.quantity,sl.original_quantity,sl.remaining_quantity,sl.source_type '+
    'FROM sale_item_lots il JOIN stock_lots sl ON sl.lot_id=il.lot_id WHERE il.invoice_id=? ORDER BY il.id'
  ).bind(id).all<any>();
  for(const lot of lots.results||[]){
    const key=String(lot.lot_id);
    const current=restored.get(key)||{
      qty:0,productId:String(lot.product_id),original:Number(lot.original_quantity),
      balance:Number(lot.remaining_quantity),type:String(lot.source_type)
    };
    current.qty+=Number(lot.quantity);restored.set(key,current);
  }
  if(!restored.size||[...restored.values()].some(l=>l.type==='OVERSOLD'||
    !Number.isSafeInteger(l.qty)||l.qty<=0||l.balance+l.qty>l.original))
    return respond({ok:false,error:'Original FIFO lots cannot be safely restored.'},409);

  const returnId='SRT-'+crypto.randomUUID().slice(0,10).toUpperCase();
  const date=new Date().toISOString().slice(0,10);
  const stmts:SqlPreparedStatement[]=[
    db.prepare(
      'INSERT INTO sales_returns (return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,'+
      'refund_method,total_return_amount,reason,notes,processed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(returnId,date,id,original.customer_id,original.customer_name,
      original.customer_phone,'Split',total/100,reason,
      'Exact original-source refund; Store Credit reissued as liability',user.fullName)
  ];
  for(const i of items){
    const n=Number(i.quantity),amount=Number(i.line_total);
    const stock=await db.prepare('SELECT current_stock FROM products WHERE product_id=?')
      .bind(i.product_id).first<{current_stock:number}>();
    if(!stock)return respond({ok:false,error:'Returned product no longer exists.'},409);
    stmts.push(db.prepare(
      'INSERT INTO sales_return_items (return_id,invoice_id,product_id,product_name,'+
      'return_quantity,return_price,line_total) VALUES (?,?,?,?,?,?,?)'
    ).bind(returnId,id,i.product_id,i.product_name,n,Number(i.unit_price),amount));
    stmts.push(db.prepare(
      "UPDATE products SET current_stock=current_stock+?,updated_at=datetime('now') WHERE product_id=?"
    ).bind(n,i.product_id));
    stmts.push(db.prepare(
      "INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) "+
      "VALUES (?,?,'Sales Return',?,0,?,?,NULL)"
    ).bind('SM-'+crypto.randomUUID().slice(0,10).toUpperCase(),
      i.product_id,n,Number(stock.current_stock)+n,returnId));
  }
  for(const [lotId,lot] of restored){
    stmts.push(db.prepare(
      'INSERT INTO split_refund_lot_restorations '+
      '(return_id,invoice_id,lot_id,product_id,quantity,prior_remaining) VALUES (?,?,?,?,?,?)'
    ).bind(returnId,id,lotId,lot.productId,lot.qty,lot.balance));
    stmts.push(db.prepare(
      "UPDATE stock_lots SET remaining_quantity=remaining_quantity+?,status='Active',updated_at=datetime('now') "+
      "WHERE lot_id=? AND source_type<>'OVERSOLD' AND remaining_quantity+?<=original_quantity"
    ).bind(lot.qty,lotId,lot.qty));
  }
  allocations.forEach((a,index)=>stmts.push(db.prepare(
    'INSERT INTO sales_return_refund_allocations '+
    '(allocation_id,return_id,invoice_id,line_number,method,amount_cents,bank_account_id,customer_id,source_key) '+
    'VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind('RA-'+crypto.randomUUID().slice(0,12).toUpperCase(),returnId,id,index+1,
    a.method,a.amountCents,a.bankAccountId,a.method==='Store Credit'?original.customer_id:'',a.sourceKey)));
  for(const a of allocations){
    const amount=a.amountCents/100;
    if(a.method==='Cash'){
      stmts.push(db.prepare(
        "INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
        "VALUES (?,?,'Sales Return',?,?,?,0,'Cash',0)"
      ).bind('CB-'+crypto.randomUUID().slice(0,10).toUpperCase(),
        date,returnId,'Original cash refund for '+id,amount));
    }else if(a.method==='Bank'||a.method==='Mobile Banking'){
      const bank=await db.prepare(
        'SELECT bank_account_id,account_name FROM bank_accounts WHERE bank_account_id=? AND status=? AND account_type=?'
      ).bind(a.bankAccountId,'Active',a.method).first<any>();
      if(!bank)return respond({ok:false,error:'Original bank/mobile account changed.'},409);
      stmts.push(db.prepare(
        'UPDATE bank_accounts SET current_balance=current_balance-? WHERE bank_account_id=? AND status=? AND account_type=?'
      ).bind(amount,a.bankAccountId,'Active',a.method));
      stmts.push(db.prepare(
        "INSERT INTO bank_book (entry_id,bank_account_id,bank_account_name,date,type,reference,description,"+
        "debit,credit,balance,status,notes,reversal_of,created_by,is_deleted) "+
        "VALUES (?,?,?,?,'Sales Return',?,?,?,0,(SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),'Active',?,?,?,0)"
      ).bind('BB-'+crypto.randomUUID().slice(0,10).toUpperCase(),a.bankAccountId,
        bank.account_name,date,returnId,'Original '+a.method+' refund for '+id,
        amount,a.bankAccountId,reason,id,user.fullName));
    }else{
      stmts.push(db.prepare(
        "INSERT INTO customer_store_credit_entries "+
        "(entry_id,customer_id,entry_type,source_type,source_id,delta_cents,balance_after_cents,note,created_by) "+
        "VALUES (?,?,'ISSUE','Sales Return',?,?,?,?,?)"
      ).bind('SC-'+crypto.randomUUID().slice(0,12).toUpperCase(),original.customer_id,returnId,
        a.amountCents,Number(credit!.available_cents)+a.amountCents,
        'Reissue original split Store Credit from '+id+'; '+reason,user.userId));
    }
  }
  stmts.push(db.prepare(
    'INSERT INTO sale_reversal_logs '+
    '(invoice_id,return_id,refund_amount_cents,reason,reversed_by,refund_method,refund_bank_account_id) '+
    'VALUES (?,?,?,?,?,?,?)'
  ).bind(id,returnId,total,reason,user.userId,'Split',''));
  stmts.push(db.prepare(
    "UPDATE sales SET status='Reversed',updated_at=datetime('now') WHERE invoice_id=? AND status='Completed' AND is_deleted=0"
  ).bind(id));
  stmts.push(db.prepare(
    "INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) "+
    "VALUES (?,'CREATE_SALES_RETURN','SALES_RETURN',?,?)"
  ).bind(user.userId,returnId,'Exact split source refund of '+id));
  stmts.push(db.prepare(
    "INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) "+
    "VALUES (?,'REVERSE_SPLIT_SALE','SALE',?,?)"
  ).bind(user.userId,id,'Return '+returnId+'; exact source refund '+total+' poisha; '+reason));
  try{await db.batch(stmts);}catch(err){
    return respond({ok:false,error:'Source-specific refund failed ledger/FIFO verification; no changes committed.'},409);
  }
  return respond({ok:true,returnId,refundCents:Number(preview.preview.refundCents),
    creditReissueCents:creditAmount});
}
