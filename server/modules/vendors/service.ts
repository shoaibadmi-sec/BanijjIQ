import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { getLedgerPrintHeader, ledgerDateWhere, ledgerHistoryMeta, parseLedgerHistory } from '../../core/ledgerHistory.js';
import { daysSince } from '../auth/permissions.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function error(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
}

function todayDate(): string { return new Date().toISOString().slice(0, 10); }
async function getOpenCashSession(db: SherDatabase) { return db.prepare(`SELECT * FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first<any>(); }

export async function addVendorRoute(db:SherDatabase,input:{name?:string;phone?:string}):Promise<Response>{const name=cleanText(input.name);if(!name)return error('Vendor name is required.');const id=`VEN-${crypto.randomUUID().slice(0,8).toUpperCase()}`;await db.prepare(`INSERT INTO vendors (vendor_id,vendor_name,phone,current_due,status) VALUES (?,?,?,0,'Active')`).bind(id,name,cleanText(input.phone)).run();return json({ok:true,vendor:{id,name,phone:cleanText(input.phone),currentDue:0,status:'Active'}});}
export async function setVendorStatusRoute(db:SherDatabase,id:string,input:{status?:string}):Promise<Response>{const status=input.status==='Inactive'?'Inactive':'Active';await db.prepare(`UPDATE vendors SET status=?,updated_at=datetime('now') WHERE vendor_id=?`).bind(status,id).run();return json({ok:true,id,status});}




function vendorId(prefix:string):string{return `${prefix}-${crypto.randomUUID().slice(0,10).toUpperCase()}`}
async function vendorCurrency(db:SherDatabase):Promise<string>{
  const r=await db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Currency Symbol' LIMIT 1`).first<{setting_value:string}>();
  return r?.setting_value||'৳';
}
async function vendorBank(db:SherDatabase,method:string,idRaw:string):Promise<any>{
  if(method!=='Bank'&&method!=='Mobile Banking')return null;
  const id=cleanText(idRaw);if(!id)throw new Error('Choose the bank/mobile banking account.');
  const a=await db.prepare(`SELECT * FROM bank_accounts WHERE bank_account_id=? AND status='Active' LIMIT 1`).bind(id).first<any>();
  if(!a)throw new Error('Selected bank/mobile banking account is not available.');
  const type=String(a.account_type||'Bank');
  if(method==='Mobile Banking'&&type!=='Mobile Banking')throw new Error('Choose a Mobile Banking account.');
  if(method==='Bank'&&type!=='Bank')throw new Error('Choose a Bank account.');
  return a;
}
function vendorBackdate(dateRaw:string,reasonRaw:string):{date:string;isBackdated:number;days:number;reason:string}{
  const today=todayDate(),date=cleanText(dateRaw)||today,reason=cleanText(reasonRaw);
  const days=Math.max(0,daysSince(date));
  if(date<today&&!reason)throw new Error('Reason for backdating is required.');
  return {date,isBackdated:date<today?1:0,days,reason};
}
async function vendorPostLedger(db:SherDatabase,fields:{vendorId:string;vendorName:string;date:string;type:string;reference:string;debit?:number;credit?:number;notes?:string;paymentMethod?:string;balanceType?:'Payable'|'Receivable';isBackdated?:number;backdatedDays?:number;backdatedReason?:string;createdBy?:string}):Promise<{ledgerId:string,balance:number}>{
  const balanceType=fields.balanceType||'Payable',debit=Number(fields.debit||0),credit=Number(fields.credit||0),delta=debit-credit;
  const col=balanceType==='Receivable'?'current_receivable':'current_due';
  const v=await db.prepare(`SELECT ${col} balance FROM vendors WHERE vendor_id=?`).bind(fields.vendorId).first<any>();
  if(!v)throw new Error('Vendor not found.');
  const next=Number(v.balance||0)+delta,ledgerId=vendorId('VL');
  await db.batch([
    db.prepare(`UPDATE vendors SET ${col}=?,updated_at=datetime('now') WHERE vendor_id=?`).bind(next,fields.vendorId),
    db.prepare(`INSERT INTO vendor_ledger(ledger_id,date,vendor_id,vendor_name,type,reference,debit,credit,balance,notes,payment_method,balance_type,is_backdated,backdated_days,backdated_reason,created_by,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
      .bind(ledgerId,fields.date,fields.vendorId,fields.vendorName,fields.type,fields.reference||'',debit,credit,next,cleanText(fields.notes),cleanText(fields.paymentMethod),balanceType,Number(fields.isBackdated||0),Number(fields.backdatedDays||0),cleanText(fields.backdatedReason),cleanText(fields.createdBy))
  ]);
  return {ledgerId,balance:next};
}
async function vendorCashOrBank(db:SherDatabase,fields:{direction:'out'|'in';method:string;bankAccountId?:string;date:string;reference:string;description:string;amount:number}):Promise<void>{
  const amount=money(fields.amount);if(amount<=0)return;
  if(fields.method==='Cash'){
    await db.prepare(`INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,?,?,?,?,?,?,0)`)
      .bind(vendorId('CB'),fields.date,fields.direction==='out'?'Vendor Payment':'Vendor Receipt',fields.reference,fields.description,fields.direction==='out'?amount:0,fields.direction==='in'?amount:0,'Cash').run();
    return;
  }
  const bank=await vendorBank(db,fields.method,cleanText(fields.bankAccountId));
  const delta=fields.direction==='in'?amount:-amount,newBal=Number(bank.current_balance||0)+delta;
  await db.batch([
    db.prepare(`INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,'Active','',0)`)
      .bind(vendorId('BB'),bank.bank_account_id,bank.account_name,fields.date,fields.direction==='out'?'Vendor Payment':'Vendor Receipt',fields.reference,fields.description,fields.direction==='out'?amount:0,fields.direction==='in'?amount:0,newBal),
    db.prepare(`UPDATE bank_accounts SET current_balance=? WHERE bank_account_id=?`).bind(newBal,bank.bank_account_id)
  ]);
}
async function vendorConsumeStock(db:SherDatabase,productId:string,quantity:number,movementType:string,reference:string,note:string):Promise<number>{
  const product=await db.prepare(`SELECT product_name,current_stock FROM products WHERE product_id=? AND is_deleted=0 LIMIT 1`).bind(productId).first<any>();
  if(!product)throw new Error('Product not found.');
  const q=Math.round(Number(quantity||0));if(q<=0)throw new Error('Enter a valid quantity.');
  if(Number(product.current_stock||0)<q)throw new Error(`Not enough stock on hand — only ${Number(product.current_stock||0)} available.`);
  const lots=await db.prepare(`SELECT lot_id,remaining_quantity FROM stock_lots WHERE product_id=? AND remaining_quantity>0 ORDER BY created_at,id`).bind(productId).all<any>();
  let need=q;const stmts:SqlPreparedStatement[]=[];const newStock=Number(product.current_stock||0)-q;
  for(const lot of lots.results||[]){
    if(need<=0)break;const avail=Number(lot.remaining_quantity||0),take=Math.min(need,avail);if(take<=0)continue;need-=take;const rem=avail-take;
    stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=?,updated_at=datetime('now'),status=CASE WHEN ?>0 THEN 'Active' ELSE 'Depleted' END WHERE lot_id=?`).bind(rem,rem,lot.lot_id));
    stmts.push(db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,?,0,?,?,?,?)`).bind(vendorId('SM'),productId,movementType,take,newStock,note,lot.lot_id));
  }
  if(need>0)throw new Error('Stock lots are insufficient for this quantity. Reconcile product stock before continuing.');
  stmts.push(db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(newStock,productId));
  await db.batch(stmts);return newStock;
}
async function vendorAddStock(db:SherDatabase,productId:string,quantity:number,unitCost:number,sourceType:string,reference:string,note:string):Promise<number>{
  const p=await db.prepare(`SELECT product_name,current_stock FROM products WHERE product_id=? AND is_deleted=0 LIMIT 1`).bind(productId).first<any>();if(!p)throw new Error('Product not found.');
  const q=Math.round(Number(quantity||0));if(q<=0)throw new Error('Enter a valid quantity.');
  const newStock=Number(p.current_stock||0)+q,lotId=vendorId('LOT');
  await db.batch([
    db.prepare(`INSERT INTO stock_lots(lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'Active',datetime('now'),datetime('now'))`).bind(lotId,productId,sourceType,reference,q,q,money(unitCost)),
    db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(newStock,productId),
    db.prepare(`INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,?,?,0,?,?,?)`).bind(vendorId('SM'),productId,sourceType,q,newStock,note,lotId)
  ]);
  return newStock;
}
export async function getVendorsBootstrapRoute(db:SherDatabase):Promise<Response>{
  const [vr,br,pr,currency,session]=await Promise.all([
    db.prepare(`SELECT vendor_id,vendor_name,phone,current_due,current_receivable,status FROM vendors ORDER BY vendor_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT bank_account_id,account_name,account_type FROM bank_accounts WHERE status='Active' ORDER BY account_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT product_id,product_name,COALESCE(brand,'') brand,category,unit,COALESCE(barcode,'') barcode,current_stock FROM products WHERE is_deleted=0 AND status<>'Inactive' ORDER BY product_name COLLATE NOCASE`).all<any>(),
    vendorCurrency(db),getOpenCashSession(db)
  ]);
  return json({ok:true,
    vendors:(vr.results||[]).map((v:any)=>({id:v.vendor_id,name:v.vendor_name,phone:v.phone||'',currentDue:Number(v.current_due||0),currentReceivable:Number(v.current_receivable||0),status:v.status||'Active'})),
    bankAccounts:(br.results||[]).map((b:any)=>({id:b.bank_account_id,name:b.account_name,type:b.account_type||'Bank'})),
    products:(pr.results||[]).map((p:any)=>({id:p.product_id,name:(String(p.brand||'').trim()?`${String(p.brand).trim()} ${p.product_name}`:p.product_name),productName:p.product_name,brand:p.brand||'',category:p.category||'',unit:p.unit||'',barcode:p.barcode||'',currentStock:Number(p.current_stock||0)})),
    currencySymbol:currency,activeCashSession:!!session
  });
}
export async function addVendorLedgerRoute(db:SherDatabase,input:{name?:string;phone?:string}):Promise<Response>{
  const name=cleanText(input.name);if(!name)return error('Vendor name is required.');
  if(await db.prepare(`SELECT 1 ok FROM vendors WHERE lower(vendor_name)=lower(?) LIMIT 1`).bind(name).first<any>())return error('A vendor with this name already exists.');
  const id=vendorId('VEN');await db.prepare(`INSERT INTO vendors(vendor_id,vendor_name,phone,current_due,current_receivable,status,created_at,updated_at) VALUES (?,?,?,0,0,'Active',datetime('now'),datetime('now'))`).bind(id,name,cleanText(input.phone)).run();
  return json({ok:true,id});
}
export async function updateVendorRoute(db:SherDatabase,id:string,input:{name?:string;phone?:string}):Promise<Response>{
  const current=await db.prepare(`SELECT vendor_id FROM vendors WHERE vendor_id=? LIMIT 1`).bind(id).first<any>();
  if(!current)return error('Vendor not found.',404);
  const name=cleanText(input.name);if(!name)return error('Vendor name is required.');
  const duplicate=await db.prepare(`SELECT vendor_id FROM vendors WHERE lower(vendor_name)=lower(?) AND vendor_id<>? LIMIT 1`).bind(name,id).first<any>();
  if(duplicate)return error('A vendor with this name already exists.');
  const phone=cleanText(input.phone);
  await db.prepare(`UPDATE vendors SET vendor_name=?,phone=?,updated_at=datetime('now') WHERE vendor_id=?`).bind(name,phone,id).run();
  return json({ok:true,id,name,phone});
}
export async function getVendorDetailRoute(db:SherDatabase,id:string,url:URL):Promise<Response>{
  const vendor=await db.prepare(`SELECT vendor_id,vendor_name,phone,current_due,current_receivable,status FROM vendors WHERE vendor_id=? LIMIT 1`).bind(id).first<any>();if(!vendor)return error('Vendor not found.',404);
  const history=parseLedgerHistory(url);
  const dateWhere=ledgerDateWhere('date',history);
  const [lr,ledgerAgg,openingAgg,sr,retTotals,issues,recvTotals,returns,received,printHeader]=await Promise.all([
    db.prepare(`
      WITH ordered AS (
        SELECT ledger_id,date,type,COALESCE(balance_type,'Payable') AS balance_type,reference,debit,credit,
               SUM(COALESCE(debit,0)-COALESCE(credit,0)) OVER (PARTITION BY COALESCE(balance_type,'Payable') ORDER BY date ASC,created_at ASC,ledger_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance,
               notes,payment_method,is_backdated,backdated_reason,created_by,created_at
        FROM vendor_ledger WHERE vendor_id=? AND COALESCE(is_deleted,0)=0
      )
      SELECT * FROM ordered WHERE date<=? AND (?='' OR date>=?)
      ORDER BY date DESC,created_at DESC,ledger_id DESC LIMIT ?
    `).bind(id,history.to,history.from,history.from,history.limit).all<any>(),
    db.prepare(`SELECT COALESCE(balance_type,'Payable') balance_type,COUNT(*) count,COALESCE(SUM(debit),0) debit,COALESCE(SUM(credit),0) credit FROM vendor_ledger WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 AND ${dateWhere.sql} GROUP BY COALESCE(balance_type,'Payable')`).bind(id,...dateWhere.values).all<any>(),
    history.from ? db.prepare(`SELECT COALESCE(balance_type,'Payable') balance_type,COALESCE(SUM(debit-credit),0) balance FROM vendor_ledger WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 AND date<? GROUP BY COALESCE(balance_type,'Payable')`).bind(id,history.from).all<any>() : Promise.resolve({results:[]}),
    db.prepare(`SELECT sourcing_id,sale_date,invoice_id,product_id,product_name,quantity,unit_cost,total_cost,created_by,created_at FROM vendor_sourcing WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 ORDER BY sale_date DESC,created_at DESC`).bind(id).all<any>(),
    db.prepare(`SELECT sourcing_id,COALESCE(SUM(quantity),0) qty FROM vendor_returns WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 GROUP BY sourcing_id`).bind(id).all<any>(),
    db.prepare(`SELECT issue_id,date,product_id,product_name,quantity,unit_value,total_value,notes,created_by,created_at FROM vendor_issues WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 ORDER BY date DESC,created_at DESC`).bind(id).all<any>(),
    db.prepare(`SELECT issue_id,COALESCE(SUM(quantity),0) qty FROM vendor_returns_received WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 GROUP BY issue_id`).bind(id).all<any>(),
    db.prepare(`SELECT return_id,date,sourcing_id,product_id,product_name,quantity,unit_cost,total_value,notes,created_by,created_at FROM vendor_returns WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 ORDER BY date DESC,created_at DESC`).bind(id).all<any>(),
    db.prepare(`SELECT return_id,date,issue_id,product_id,product_name,quantity,unit_value,total_value,notes,created_by,created_at FROM vendor_returns_received WHERE vendor_id=? AND COALESCE(is_deleted,0)=0 ORDER BY date DESC,created_at DESC`).bind(id).all<any>(),
    getLedgerPrintHeader(db)
  ]);
  const retMap=new Map<string,number>((retTotals.results||[]).map((r:any)=>[r.sourcing_id,Number(r.qty||0)]));
  const recvMap=new Map<string,number>((recvTotals.results||[]).map((r:any)=>[r.issue_id,Number(r.qty||0)]));
  const sourcingHistory=(sr.results||[]).map((s:any)=>{
    const returned=retMap.get(s.sourcing_id)||0,quantity=Number(s.quantity||0),remaining=Math.max(0,quantity-returned);
    return{sourcingId:s.sourcing_id,date:String(s.sale_date||'').slice(0,10),invoiceId:s.invoice_id||'',productId:s.product_id,productName:s.product_name,quantity,unitCost:Number(s.unit_cost||0),totalCost:Number(s.total_cost||0),returnedQty:returned,remainingQty:remaining,status:remaining>0?'Open':'Settled',createdBy:s.created_by||'',createdAt:s.created_at||''};
  });
  const issueHistory=(issues.results||[]).map((s:any)=>{
    const returned=recvMap.get(s.issue_id)||0,quantity=Number(s.quantity||0),remaining=Math.max(0,quantity-returned);
    return{issueId:s.issue_id,date:String(s.date||'').slice(0,10),productId:s.product_id,productName:s.product_name,quantity,unitValue:Number(s.unit_value||0),totalValue:Number(s.total_value||0),returnedQty:returned,remainingQty:remaining,status:remaining>0?'Open':'Settled',notes:s.notes||'',createdBy:s.created_by||'',createdAt:s.created_at||''};
  });
  const ledger=(lr.results||[]).map((l:any)=>({ledgerId:l.ledger_id,date:String(l.date||'').slice(0,10),type:l.type,balanceType:l.balance_type||'Payable',reference:l.reference||'',debit:Number(l.debit||0),credit:Number(l.credit||0),balance:Number(l.balance||0),notes:l.notes||'',paymentMethod:l.payment_method||'',isBackdated:!!l.is_backdated,backdatedReason:l.backdated_reason||'',createdBy:l.created_by||''}));
  const aggMap=new Map<string,any>((ledgerAgg.results||[]).map((r:any)=>[String(r.balance_type||'Payable'),r]));
  const openingMap=new Map<string,number>((openingAgg.results||[]).map((r:any)=>[String(r.balance_type||'Payable'),Number(r.balance||0)]));
  const summaryFor=(kind:'Payable'|'Receivable')=>{
    const agg=aggMap.get(kind)||{},rangeOpeningBalance=openingMap.get(kind)||0,rangeClosingBalance=rangeOpeningBalance+Number(agg.debit||0)-Number(agg.credit||0);
    const subset=ledger.filter((r:any)=>r.balanceType===kind);
    const earliest=subset.length?subset[subset.length-1]:null,latest=subset.length?subset[0]:null;
    return{rangeOpeningBalance,rangeClosingBalance,displayedOpeningBalance:earliest?Number(earliest.balance)-Number(earliest.debit)+Number(earliest.credit):rangeOpeningBalance,displayedClosingBalance:latest?Number(latest.balance):rangeOpeningBalance,totalDebit:subset.reduce((n:number,r:any)=>n+Number(r.debit||0),0),totalCredit:subset.reduce((n:number,r:any)=>n+Number(r.credit||0),0)};
  };
  const matchingCount=(ledgerAgg.results||[]).reduce((n:number,r:any)=>n+Number(r.count||0),0);
  return json({ok:true,
    vendor:{id:vendor.vendor_id,name:vendor.vendor_name,phone:vendor.phone||'',currentDue:Number(vendor.current_due||0),currentReceivable:Number(vendor.current_receivable||0),status:vendor.status||'Active'},
    ledger,history:ledgerHistoryMeta(history,matchingCount,ledger.length),payableSummary:summaryFor('Payable'),receivableSummary:summaryFor('Receivable'),printHeader,
    openSourcing:sourcingHistory.filter((s:any)=>s.remainingQty>0).map(({totalCost,status,createdBy,createdAt,...s}:any)=>s),
    openIssues:issueHistory.filter((s:any)=>s.remainingQty>0).map(({totalValue,status,notes,createdBy,createdAt,...s}:any)=>s),
    sourcingHistory,
    returnHistory:(returns.results||[]).map((r:any)=>({returnId:r.return_id,date:String(r.date||'').slice(0,10),sourcingId:r.sourcing_id||'',productId:r.product_id,productName:r.product_name,quantity:Number(r.quantity||0),unitCost:Number(r.unit_cost||0),totalValue:Number(r.total_value||0),notes:r.notes||'',createdBy:r.created_by||'',createdAt:r.created_at||''})),
    issueHistory,
    receivedHistory:(received.results||[]).map((r:any)=>({returnId:r.return_id,date:String(r.date||'').slice(0,10),issueId:r.issue_id||'',productId:r.product_id,productName:r.product_name,quantity:Number(r.quantity||0),unitValue:Number(r.unit_value||0),totalValue:Number(r.total_value||0),notes:r.notes||'',createdBy:r.created_by||'',createdAt:r.created_at||''}))
  });
}

export async function payVendorLedgerRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before paying a vendor.');
  const v=await db.prepare(`SELECT * FROM vendors WHERE vendor_id=?`).bind(id).first<any>();if(!v)return error('Vendor not found.',404);
  const amount=money(input.amount);if(amount<=0)return error('Enter a valid payment amount.');
  let tx;try{tx=vendorBackdate(input.date,input.backdatedReason)}catch(e){return error(e instanceof Error?e.message:'Invalid date.')}
  const method=cleanText(input.method)||'Cash';try{if(method!=='Cash')await vendorBank(db,method,input.bankAccountId)}catch(e){return error(e instanceof Error?e.message:'Invalid account.')}
  const posted=await vendorPostLedger(db,{vendorId:id,vendorName:v.vendor_name,date:tx.date,type:'Payment',reference:'PAYMENT',credit:amount,notes:input.notes,paymentMethod:method,isBackdated:tx.isBackdated,backdatedDays:tx.days,backdatedReason:tx.reason,createdBy:user.fullName});
  try{await vendorCashOrBank(db,{direction:'out',method,bankAccountId:input.bankAccountId,date:tx.date,reference:posted.ledgerId,description:`Payment to ${v.vendor_name}`,amount})}catch(e){return error(e instanceof Error?e.message:'Payment posting failed.')}
  return json({ok:true,ledgerId:posted.ledgerId,newDue:posted.balance});
}
export async function returnProductsToVendorRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before returning products to a vendor.');
  const v=await db.prepare(`SELECT * FROM vendors WHERE vendor_id=?`).bind(id).first<any>();if(!v)return error('Vendor not found.',404);
  const s=await db.prepare(`SELECT * FROM vendor_sourcing WHERE sourcing_id=? AND vendor_id=? AND COALESCE(is_deleted,0)=0`).bind(cleanText(input.sourcingId),id).first<any>();if(!s)return error('Sourcing transaction not found.');
  const returned=await db.prepare(`SELECT COALESCE(SUM(quantity),0) qty FROM vendor_returns WHERE sourcing_id=? AND COALESCE(is_deleted,0)=0`).bind(s.sourcing_id).first<any>();
  const remaining=Number(s.quantity||0)-Number(returned?.qty||0),q=Math.round(Number(input.quantity||0));if(q<=0)return error('Enter a valid quantity.');if(q>remaining)return error(`Only ${remaining} unit(s) are left unsettled on this sourcing transaction.`);
  const unitCost=money(input.unitCost??s.unit_cost);let tx;try{tx=vendorBackdate(input.date,input.backdatedReason)}catch(e){return error(e instanceof Error?e.message:'Invalid date.')}
  try{await vendorConsumeStock(db,s.product_id,q,'Vendor Return',s.sourcing_id,`Returned to ${v.vendor_name}`)}catch(e){return error(e instanceof Error?e.message:'Stock return failed.')}
  const rid=vendorId('VR'),total=q*unitCost;
  await db.prepare(`INSERT INTO vendor_returns(return_id,date,vendor_id,vendor_name,sourcing_id,product_id,product_name,quantity,unit_cost,total_value,notes,created_by,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).bind(rid,tx.date,id,v.vendor_name,s.sourcing_id,s.product_id,s.product_name,q,unitCost,total,cleanText(input.notes),user.fullName).run();
  await vendorPostLedger(db,{vendorId:id,vendorName:v.vendor_name,date:tx.date,type:'Return',reference:rid,credit:total,notes:`Returned ${q} x ${s.product_name} (Sourcing ${s.sourcing_id})`,isBackdated:tx.isBackdated,backdatedDays:tx.days,backdatedReason:tx.reason,createdBy:user.fullName});
  return json({ok:true,returnId:rid});
}
export async function giveProductsToVendorRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before giving products to a vendor.');
  const v=await db.prepare(`SELECT * FROM vendors WHERE vendor_id=?`).bind(id).first<any>();if(!v)return error('Vendor not found.',404);
  const p=await db.prepare(`SELECT * FROM products WHERE product_id=? AND is_deleted=0`).bind(cleanText(input.productId)).first<any>();if(!p)return error('Product not found.');
  const q=Math.round(Number(input.quantity||0));if(q<=0)return error('Enter a valid quantity.');const unitValue=money(input.unitValue);
  let tx;try{tx=vendorBackdate(input.date,input.backdatedReason)}catch(e){return error(e instanceof Error?e.message:'Invalid date.')}
  try{await vendorConsumeStock(db,p.product_id,q,'Vendor Issue',id,`Given to ${v.vendor_name}`)}catch(e){return error(e instanceof Error?e.message:'Stock issue failed.')}
  const issueId=vendorId('VI'),total=q*unitValue;
  await db.prepare(`INSERT INTO vendor_issues(issue_id,date,vendor_id,vendor_name,product_id,product_name,quantity,unit_value,total_value,notes,created_by,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`).bind(issueId,tx.date,id,v.vendor_name,p.product_id,p.product_name,q,unitValue,total,cleanText(input.notes),user.fullName).run();
  await vendorPostLedger(db,{vendorId:id,vendorName:v.vendor_name,date:tx.date,type:'Issue',reference:issueId,debit:total,balanceType:'Receivable',notes:`Gave ${q} x ${p.product_name}`,isBackdated:tx.isBackdated,backdatedDays:tx.days,backdatedReason:tx.reason,createdBy:user.fullName});
  return json({ok:true,issueId});
}
export async function receiveVendorPaymentRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before receiving vendor payment.');
  const v=await db.prepare(`SELECT * FROM vendors WHERE vendor_id=?`).bind(id).first<any>();if(!v)return error('Vendor not found.',404);
  const amount=money(input.amount);if(amount<=0)return error('Enter a valid amount.');
  let tx;try{tx=vendorBackdate(input.date,input.backdatedReason)}catch(e){return error(e instanceof Error?e.message:'Invalid date.')}
  const method=cleanText(input.method)||'Cash';try{if(method!=='Cash')await vendorBank(db,method,input.bankAccountId)}catch(e){return error(e instanceof Error?e.message:'Invalid account.')}
  const posted=await vendorPostLedger(db,{vendorId:id,vendorName:v.vendor_name,date:tx.date,type:'Receipt',reference:'RECEIPT',credit:amount,balanceType:'Receivable',notes:input.notes,paymentMethod:method,isBackdated:tx.isBackdated,backdatedDays:tx.days,backdatedReason:tx.reason,createdBy:user.fullName});
  try{await vendorCashOrBank(db,{direction:'in',method,bankAccountId:input.bankAccountId,date:tx.date,reference:posted.ledgerId,description:`Received from ${v.vendor_name}`,amount})}catch(e){return error(e instanceof Error?e.message:'Receipt posting failed.')}
  return json({ok:true,ledgerId:posted.ledgerId,newReceivable:posted.balance});
}
export async function receiveProductsFromVendorRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start the POS Cash Session before receiving products from a vendor.');
  const v=await db.prepare(`SELECT * FROM vendors WHERE vendor_id=?`).bind(id).first<any>();if(!v)return error('Vendor not found.',404);
  const issue=await db.prepare(`SELECT * FROM vendor_issues WHERE issue_id=? AND vendor_id=? AND COALESCE(is_deleted,0)=0`).bind(cleanText(input.issueId),id).first<any>();if(!issue)return error('Issue transaction not found.');
  const returned=await db.prepare(`SELECT COALESCE(SUM(quantity),0) qty FROM vendor_returns_received WHERE issue_id=? AND COALESCE(is_deleted,0)=0`).bind(issue.issue_id).first<any>();
  const remaining=Number(issue.quantity||0)-Number(returned?.qty||0),q=Math.round(Number(input.quantity||0));if(q<=0)return error('Enter a valid quantity.');if(q>remaining)return error(`Only ${remaining} unit(s) are left unsettled on this issue transaction.`);
  const unitValue=money(input.unitValue??issue.unit_value);let tx;try{tx=vendorBackdate(input.date,input.backdatedReason)}catch(e){return error(e instanceof Error?e.message:'Invalid date.')}
  const rid=vendorId('VRR');try{await vendorAddStock(db,issue.product_id,q,unitValue,'Vendor Return Received',rid,`Received back from ${v.vendor_name}`)}catch(e){return error(e instanceof Error?e.message:'Stock receipt failed.')}
  const total=q*unitValue;
  await db.prepare(`INSERT INTO vendor_returns_received(return_id,date,vendor_id,vendor_name,issue_id,product_id,product_name,quantity,unit_value,total_value,notes,created_by,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).bind(rid,tx.date,id,v.vendor_name,issue.issue_id,issue.product_id,issue.product_name,q,unitValue,total,cleanText(input.notes),user.fullName).run();
  await vendorPostLedger(db,{vendorId:id,vendorName:v.vendor_name,date:tx.date,type:'Return Received',reference:rid,credit:total,balanceType:'Receivable',notes:`Received back ${q} x ${issue.product_name} (Issue ${issue.issue_id})`,isBackdated:tx.isBackdated,backdatedDays:tx.days,backdatedReason:tx.reason,createdBy:user.fullName});
  return json({ok:true,returnId:rid});
}
