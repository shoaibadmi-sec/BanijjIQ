import type {SherDatabase} from '../../db/types.js';

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
