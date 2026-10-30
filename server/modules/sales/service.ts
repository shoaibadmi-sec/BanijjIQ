import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { daysSince, hasModulePermission } from '../auth/permissions.js';
import type { PosSaleInput } from './types.js';
import {quoteUnitQuantities, type UnitProfile} from '../products/unitProfile.js';
import { aggregateSaleTrackingDraws, getAvailabilityMap, planTrackedSale, trackingEnabled, warrantyEndDate } from '../products/tracking.service.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
function error(message: string, status = 400): Response { return json({ ok: false, error: message }, status); }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }
function qty(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10000) / 10000;
}
function todayDate(): string { return new Date().toISOString().slice(0, 10); }
function nowTime(): string { return new Date().toISOString().slice(11, 19); }
async function getOpenCashSession(db: SherDatabase) { return db.prepare(`SELECT * FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1`).first<any>(); }
async function readBody<T>(request: Request): Promise<T> {
  try { return await request.json() as T; }
  catch { throw new Error('Invalid JSON body'); }
}

export async function getCashSessionSummaryRoute(db: SherDatabase): Promise<Response> {
  const session = await getOpenCashSession(db);
  if (!session) return json({ ok: true, summary: null });
  const openEntry = await db.prepare(`SELECT rowid AS row_num FROM cash_book WHERE type='Session Open' AND reference=? ORDER BY rowid DESC LIMIT 1`).bind(session.session_id).first<{ row_num: number }>();
  const totals = await db.prepare(`SELECT COALESCE(SUM(credit),0) cash_in, COALESCE(SUM(debit),0) cash_out FROM cash_book WHERE is_deleted=0 AND rowid>?`).bind(Number(openEntry?.row_num ?? 0)).first<{ cash_in: number; cash_out: number }>();
  const openingCash = Number(session.opening_cash || 0), cashIn = Number(totals?.cash_in || 0), cashOut = Number(totals?.cash_out || 0);
  return json({ ok: true, summary: { sessionId: session.session_id, openedAt: session.opened_at, openingCash, cashIn, cashOut, expectedCash: openingCash + cashIn - cashOut } });
}

export async function startCashSessionRoute(db: SherDatabase, input: { openingCash?: number; notes?: string }, user: AuthUser): Promise<Response> {
  const openingCash = Number(input.openingCash ?? 0);
  if (!Number.isFinite(openingCash) || openingCash < 0) return error('Enter a valid opening cash amount.');
  if (await getOpenCashSession(db)) return error('A cash session is already open. Close it before starting a new one.');
  const sessionId = `CS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await db.batch([
    db.prepare(`INSERT INTO cash_sessions (session_id,opened_by,opened_at,opening_cash,opening_note,status) VALUES (?,?,datetime('now'),?,?,'Open')`).bind(sessionId, user.fullName, openingCash, cleanText(input.notes)),
    db.prepare(`INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?, 'Session Open',?,'Opening cash for the day',0,?,'Cash',0)`).bind(`CB-${crypto.randomUUID().slice(0,10).toUpperCase()}`, todayDate(), sessionId, openingCash)
  ]);
  return json({ ok: true, sessionId });
}

export async function closeCashSessionRoute(db: SherDatabase, input: { countedCash?: number; notes?: string }, user: AuthUser): Promise<Response> {
  const countedCash = Number(input.countedCash ?? NaN);
  if (!Number.isFinite(countedCash) || countedCash < 0) return error('Enter a valid counted cash amount.');
  const session = await getOpenCashSession(db); if (!session) return error('No cash session is open.');
  const openEntry = await db.prepare(`SELECT rowid AS row_num FROM cash_book WHERE type='Session Open' AND reference=? ORDER BY rowid DESC LIMIT 1`).bind(session.session_id).first<{ row_num: number }>();
  const totals = await db.prepare(`SELECT COALESCE(SUM(credit),0) cash_in, COALESCE(SUM(debit),0) cash_out FROM cash_book WHERE is_deleted=0 AND rowid>?`).bind(Number(openEntry?.row_num ?? 0)).first<{ cash_in: number; cash_out: number }>();
  const expected = Number(session.opening_cash || 0) + Number(totals?.cash_in || 0) - Number(totals?.cash_out || 0), variance = countedCash - expected;
  const stmts: SqlPreparedStatement[] = [db.prepare(`UPDATE cash_sessions SET closed_at=datetime('now'),expected_cash=?,counted_cash=?,variance=?,status='Closed',closing_note=? WHERE session_id=?`).bind(expected,countedCash,variance,cleanText(input.notes),session.session_id)];
  if (variance !== 0) stmts.push(db.prepare(`INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?, 'Day Close Adjustment',?,?,?,?,'Cash',0)`).bind(`CB-${crypto.randomUUID().slice(0,10).toUpperCase()}`, todayDate(), session.session_id, variance>0?'Cash counted was higher than expected':'Cash counted was lower than expected', variance<0?Math.abs(variance):0, variance>0?variance:0));
  stmts.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'CLOSE_CASH_SESSION','CASH_SESSION',?,?)`).bind(user.userId,session.session_id,`Expected ${expected}; counted ${countedCash}; variance ${variance}`));
  await db.batch(stmts); return json({ ok: true, expected, counted: countedCash, variance });
}

export async function getPosBootstrapRoute(db: SherDatabase, user: AuthUser): Promise<Response> {
  const [pr, cr, br, vr, session, settingsRows, profileRows] = await Promise.all([
    db.prepare(`SELECT product_id,product_name,COALESCE(brand,'') brand,category,unit,barcode,purchase_price,selling_price,current_stock,minimum_stock,track_serial,track_expiry,track_warranty,warranty_period_value,warranty_period_unit FROM products WHERE is_deleted=0 AND status<>'Inactive' ORDER BY product_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT customer_id,customer_name,phone,father_name,address,current_due FROM customers WHERE is_deleted=0 AND status='Active' ORDER BY customer_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT bank_account_id,account_name,account_type FROM bank_accounts WHERE status='Active' ORDER BY account_name`).all<any>(),
    db.prepare(`SELECT vendor_id,vendor_name,phone,current_due,status FROM vendors ORDER BY vendor_name COLLATE NOCASE`).all<any>(),
    getOpenCashSession(db),
    db.prepare(`SELECT setting_key,setting_value FROM app_settings`).all<{setting_key:string;setting_value:string}>(),
    db.prepare('SELECT product_id,profile_json,revision FROM product_unit_profiles').all<{product_id:string;profile_json:string;revision:number}>()
  ]);
  const profiles=new Map((profileRows.results||[]).map(row=>[row.product_id,{...JSON.parse(row.profile_json),revision:row.revision,postingEnabled:true}]));
  const settings:Record<string,string>={};
  for(const row of settingsRows.results||[]) settings[row.setting_key]=row.setting_value||'';
  const showPurchasePrice = String(settings['POS Show Purchase Price'] || '').trim().toLowerCase() === 'true' && await hasModulePermission(db,user,'posCost','view');
  const availability=await getAvailabilityMap(db);
  const vendorsAll=(vr.results||[]).map((v:any)=>({id:v.vendor_id,name:v.vendor_name,phone:v.phone||'',currentDue:Number(v.current_due||0),status:v.status}));
  return json({ ok:true,
    products:(pr.results||[]).map((p:any)=>({
      id:p.product_id,name:(String(p.brand||'').trim()?`${String(p.brand).trim()} ${p.product_name}`:p.product_name),productName:p.product_name,brand:p.brand||'',category:p.category,unit:p.unit,barcode:p.barcode||'',
      ...(showPurchasePrice?{purchasePrice:Number(p.purchase_price||0)}:{}),
      sellingPrice:Number(p.selling_price||0),stock:availability.get(String(p.product_id))?.sellable??Number(p.current_stock||0),totalStock:Number(p.current_stock||0),
      pendingTracking:availability.get(String(p.product_id))?.pending??0,expiredStock:availability.get(String(p.product_id))?.expired??0,minimumStock:Number(p.minimum_stock||0),
      trackSerial:!!p.track_serial,trackExpiry:!!p.track_expiry,trackWarranty:!!p.track_warranty,warrantyPeriodValue:Number(p.warranty_period_value||0),warrantyPeriodUnit:p.warranty_period_unit||'Months',
      unitProfilePreview:profiles.get(p.product_id)??null
    })),
    customers:(cr.results||[]).map((c:any)=>({id:c.customer_id,name:c.customer_name,phone:c.phone,fatherName:c.father_name||'',address:c.address||'',currentDue:Number(c.current_due||0)})),
    bankAccounts:(br.results||[]).map((b:any)=>({id:b.bank_account_id,name:b.account_name,accountType:b.account_type||'Bank'})),
    vendors:vendorsAll.filter((v:any)=>v.status!=='Inactive'), vendorsAll,
    activeSession:session?{sessionId:session.session_id,openedAt:session.opened_at,openingCash:Number(session.opening_cash||0)}:null,
    showPurchasePrice,
    invoiceDesign:{settings,logoDataUri:settings['Invoice Logo']||''}
  });
}

async function saleFingerprint(input:PosSaleInput):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

export async function completeSaleRoute(db:SherDatabase,input:PosSaleInput,user:AuthUser):Promise<Response>{
  const requestId=cleanText(input.clientRequestId);
  if(requestId&&!/^[A-Za-z0-9_-]{8,128}$/.test(requestId))return error('Invalid sale request key.');
  const fingerprint=requestId?await saleFingerprint(input):'';
  if(requestId){
    const prior=await db.prepare('SELECT payload_sha256,invoice_id FROM pos_sale_requests WHERE request_id=?').bind(requestId)
      .first<{payload_sha256:string;invoice_id:string}>();
    if(prior){
      if(prior.payload_sha256!==fingerprint)return error('Sale request key was already used for different sale details.',409);
      return getInvoiceRoute(db,prior.invoice_id);
    }
  }
  if(!(await getOpenCashSession(db))) return error('Start your cash session first (POS page → Start Day) before recording any transaction.');
  const customerName=cleanText(input.customerName), customerPhone=cleanText(input.customerPhone); if(!customerName||!customerPhone) return error('Customer name and phone are required for every sale.');
  if(!input.items?.length) return error('Cart is empty.');
  const date=cleanText(input.date)||todayDate(); if(date>todayDate())return error('Sale date cannot be in the future.');if(date<todayDate()&&!cleanText(input.backdatedReason))return error('Backdated sale reason is required.');
  const seen=new Set<string>(); let subtotal=0; const lines:any[]=[];
  for(let i=0;i<input.items.length;i++){
    const item=input.items[i], productId=cleanText(item.productId), qRaw=Number(item.qty||0), q=Math.round(qRaw), price=Number(item.unitPrice??0);
    let unitSnapshot: null | {profile:UnitProfile; revision:number; quantities:Record<string,number>; description:string; lineTotal:number}=null;
    if(item.unitQuantities!==undefined || item.unitProfileRevision!==undefined){
      if(!item.unitQuantities || typeof item.unitQuantities!=='object' || Array.isArray(item.unitQuantities) ||
         !Number.isSafeInteger(item.unitProfileRevision) || Number(item.unitProfileRevision)<1)
        return error('Mixed-unit sale needs a saved unit profile and exact unit quantities.');
      const saved=await db.prepare('SELECT revision,profile_json FROM product_unit_profiles WHERE product_id=?')
        .bind(productId).first<{revision:number;profile_json:string}>();
      if(!saved || saved.revision!==item.unitProfileRevision)
        return error('Unit conversion was updated. Refresh the sale before posting.',409);
      try{
        const profile=JSON.parse(saved.profile_json) as UnitProfile;
        const quote=quoteUnitQuantities(profile,item.unitQuantities);
        if(qRaw!==quote.baseQuantity)return error('Mixed-unit base quantity does not match entered units.');
        if(quote.lineTotal>1000000000)return error('Sale total is outside the supported range.');
        unitSnapshot={profile,revision:saved.revision,quantities:item.unitQuantities,
          description:quote.description,lineTotal:quote.lineTotal};
      }catch(e){return error(e instanceof Error?e.message:'Invalid mixed-unit quantities.');}
    }
    if(!productId||!Number.isFinite(qRaw)||qRaw<=0||!Number.isInteger(qRaw)) return error(`Line ${i+1}: quantity must be a whole number greater than zero.`); if(!Number.isFinite(price)||price<0) return error(`Line ${i+1}: price must be a valid number.`);
    if(seen.has(productId)) return error(`${cleanText(item.name)||'Product'} appears more than once — combine it into one line.`); seen.add(productId);
    const product=await db.prepare(`SELECT product_id,product_name,COALESCE(brand,'') brand,unit,purchase_price,current_stock,track_serial,track_expiry,track_warranty,warranty_period_value,warranty_period_unit FROM products WHERE product_id=? AND is_deleted=0 AND status<>'Inactive'`).bind(productId).first<any>(); if(!product) return error(`Product ${cleanText(item.name)} no longer exists.`);
    const isTracked=trackingEnabled(product); let trackingDraws:any[]=[]; const draws:any[]=[]; let need=q;
    if(isTracked){
      if(cleanText(item.vendorId)||cleanText(item.fulfillmentMode)==='negative') return error(`${product.product_name}: tracked products cannot use Vendor Sourcing or Negative Stock.`);
      try{trackingDraws=await planTrackedSale(db,product,q,item.serialNumbers,date);}catch(err){return error(err instanceof Error?err.message:'Tracked stock is not ready.');}
      const aggregated=aggregateSaleTrackingDraws(trackingDraws);
      for(const [lotId,take] of aggregated.lots){const lot=await db.prepare(`SELECT id,lot_id,remaining_quantity,unit_cost,supplier_id FROM stock_lots WHERE lot_id=? LIMIT 1`).bind(lotId).first<any>();if(!lot||Number(lot.remaining_quantity||0)<take)return error(`${product.product_name}: tracked stock lot is no longer available.`);draws.push({...lot,take,remainingAfter:Number(lot.remaining_quantity)-take});}
      need=0;
    }else{
      const lots=await db.prepare(`SELECT id,lot_id,remaining_quantity,unit_cost,supplier_id FROM stock_lots WHERE product_id=? AND remaining_quantity>0 ORDER BY id`).bind(productId).all<any>();
      for(const lot of lots.results||[]){ if(need<=0) break; const take=Math.min(need,Number(lot.remaining_quantity||0)); if(take>0){draws.push({...lot,take,remainingAfter:Number(lot.remaining_quantity)-take}); need-=take;} }
    }
    const vendorId=cleanText(item.vendorId); const fulfillmentMode=cleanText(item.fulfillmentMode); let vendor:any=null,vendorQty=0,vendorUnitCost=0;
    if(!isTracked&&vendorId){ if(need<=0) return error(`${product.product_name}: there is no shortage on this line to source from a vendor.`); vendor=await db.prepare(`SELECT vendor_id,vendor_name,current_due FROM vendors WHERE vendor_id=?`).bind(vendorId).first<any>(); if(!vendor) return error(`${product.product_name}: vendor not found.`); vendorUnitCost=Number(item.vendorUnitCost??NaN); if(!Number.isFinite(vendorUnitCost)||vendorUnitCost<0) return error(`${product.product_name}: enter a valid vendor unit cost.`); vendorQty=need; need=0; }
    if(need>0 && fulfillmentMode!=='negative') return error(`${product.product_name}: stock is short by ${need}. Choose Vendor Sourcing or Negative Stock.`);
    const lineTotal=unitSnapshot?unitSnapshot.lineTotal:q*price;
    lines.push({product,q,price:unitSnapshot?lineTotal/q:price,lineTotal,unitSnapshot,draws,trackingDraws,shortfall:need,vendor,vendorQty,vendorUnitCost,ownQty:q-vendorQty,isTracked}); subtotal+=lineTotal;
  }
  const discount=Math.max(0,Number(input.discount||0)), grandTotal=Math.max(0,subtotal-discount); let paidAmount=0,dueAmount=0;
  if(input.paymentType==='Cash') paidAmount=grandTotal; else if(input.paymentType==='Due') dueAmount=grandTotal; else if(input.paymentType==='Partial'){paidAmount=Number(input.paidAmount||0);if(paidAmount<=0||paidAmount>=grandTotal)return error('Partial payment must be more than 0 and less than the grand total.');dueAmount=grandTotal-paidAmount;} else return error('Choose a payment type.');
  const paymentStatus=dueAmount<=0?'Paid':paidAmount>0?'Partial':'Due', paymentMethod=paidAmount>0?(cleanText(input.paymentMethod)||'Cash'):''; let bankId='',bankName='';
  if(paidAmount>0&&(paymentMethod==='Bank'||paymentMethod==='Mobile Banking')){bankId=cleanText(input.bankAccountId);if(!bankId)return error(paymentMethod==='Mobile Banking'?'Select a mobile banking account.':'Select a bank account.');const b=await db.prepare(`SELECT bank_account_id,account_name,account_type FROM bank_accounts WHERE bank_account_id=? AND status='Active'`).bind(bankId).first<any>();if(!b)return error('Bank/mobile banking account not found.');const wantType=paymentMethod==='Mobile Banking'?'Mobile Banking':'Bank',actualType=cleanText(b.account_type)||'Bank';if(actualType!==wantType)return error(`Selected account is not a ${wantType} account.`);bankName=b.account_name;}
  const invoiceId=`INV-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0,4).toUpperCase()}`, stmts:SqlPreparedStatement[]=[];
  // Customer creation and contact edits must not escape a failed invoice batch.
  let customerId=cleanText(input.customerId);
  if(dueAmount>0){
    const existing=await db.prepare('SELECT customer_id,current_due FROM customers WHERE phone=? AND is_deleted=0 LIMIT 1')
      .bind(customerPhone).first<{customer_id:string;current_due:number}>();
    customerId=existing?.customer_id || `CUS-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
    if(existing)stmts.push(db.prepare(
      "UPDATE customers SET customer_name=?,father_name=?,address=?,updated_at=datetime('now') WHERE customer_id=?"
    ).bind(customerName,cleanText(input.customerFatherName),cleanText(input.customerAddress),customerId));
    else stmts.push(db.prepare(
      "INSERT INTO customers (customer_id,customer_name,phone,father_name,address,current_due,status,is_deleted) VALUES (?,?,?,?,?,0,'Active',0)"
    ).bind(customerId,customerName,customerPhone,cleanText(input.customerFatherName),cleanText(input.customerAddress)));
  }
  if(requestId)stmts.push(db.prepare(
    'INSERT INTO pos_sale_requests (request_id,payload_sha256,invoice_id) VALUES (?,?,?)'
  ).bind(requestId,fingerprint,invoiceId));
  stmts.push(db.prepare(`INSERT INTO sales (invoice_id,sale_date,sale_time,customer_id,customer_name,customer_phone,customer_address,customer_father_name,subtotal,discount,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method,bank_account_id,bank_account_name,is_backdated,backdated_reason,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Completed',?)`).bind(invoiceId,date,nowTime(),customerId,customerName,customerPhone,cleanText(input.customerAddress),cleanText(input.customerFatherName),subtotal,discount,grandTotal,paidAmount,dueAmount,input.paymentType,paymentStatus,paymentMethod,bankId,bankName,date<todayDate()?1:0,cleanText(input.backdatedReason),user.fullName));
  for(const line of lines){
    const displayName=String(line.product.brand||'').trim()?`${String(line.product.brand).trim()} ${line.product.product_name}`:line.product.product_name;
    stmts.push(db.prepare(`INSERT INTO sale_items (invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)`).bind(invoiceId,line.product.product_id,displayName,line.q,line.price,line.lineTotal));
    if(line.unitSnapshot){
      const snap=line.unitSnapshot;
      stmts.push(db.prepare(`INSERT INTO sale_item_unit_snapshots
        (invoice_id,product_id,profile_revision,profile_json,quantities_json,description,base_quantity,line_total_cents)
        VALUES (?,?,?,?,?,?,?,?)`).bind(invoiceId,line.product.product_id,snap.revision,
        JSON.stringify(snap.profile),JSON.stringify(snap.quantities),snap.description,line.q,Math.round(line.lineTotal*100)));
    }
    stmts.push(db.prepare(`UPDATE products SET current_stock=current_stock-?,updated_at=datetime('now') WHERE product_id=?`).bind(line.ownQty,line.product.product_id));
    for(const d of line.draws){stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=remaining_quantity-?,updated_at=datetime('now'),status=CASE WHEN remaining_quantity-?>0 THEN 'Active' ELSE 'Depleted' END WHERE lot_id=?`).bind(d.take,d.take,d.lot_id));stmts.push(db.prepare(`INSERT INTO sale_item_lots (invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id) VALUES (?,?,?,?,?,?)`).bind(invoiceId,line.product.product_id,d.lot_id,d.take,Number(d.unit_cost||0),d.supplier_id||''));stmts.push(db.prepare(`INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?, 'Sale',0,?,(SELECT current_stock FROM products WHERE product_id=?),?,?)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`,line.product.product_id,d.take,line.product.product_id,invoiceId,d.lot_id));}
    if(line.isTracked){
      const aggregated=aggregateSaleTrackingDraws(line.trackingDraws);
      for(const [batchId,take] of aggregated.batches)stmts.push(db.prepare(`UPDATE stock_expiry_batches SET remaining_quantity=remaining_quantity-?,updated_at=datetime('now') WHERE expiry_batch_id=?`).bind(take,batchId));
      for(const t of line.trackingDraws){
        stmts.push(db.prepare(`INSERT INTO sale_item_tracking (invoice_id,product_id,lot_id,serial_id,serial_number,expiry_batch_id,quantity) VALUES (?,?,?,?,?,?,?)`).bind(invoiceId,line.product.product_id,t.lotId,t.serialId||null,t.serialNumber||'',t.expiryBatchId||null,t.quantity));
        if(t.serialId)stmts.push(db.prepare(`UPDATE product_serials SET status='Sold',sale_invoice_id=?,sold_at=datetime('now'),returned_at=NULL,updated_at=datetime('now') WHERE serial_id=?`).bind(invoiceId,t.serialId));
      }
    }
    if(line.shortfall>0){const lotId=`LOT-${crypto.randomUUID().slice(0,10).toUpperCase()}`;stmts.push(db.prepare(`INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'OVERSOLD',?,0,?,?,'Oversold')`).bind(lotId,line.product.product_id,invoiceId,-line.shortfall,Number(line.product.purchase_price||0)));stmts.push(db.prepare(`INSERT INTO sale_item_lots (invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id) VALUES (?,?,?,?,?,'')`).bind(invoiceId,line.product.product_id,lotId,line.shortfall,Number(line.product.purchase_price||0)));stmts.push(db.prepare(`INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?, 'Sale',0,?,(SELECT current_stock FROM products WHERE product_id=?),?,?)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`,line.product.product_id,line.shortfall,line.product.product_id,invoiceId,lotId));}
    if(line.vendor){const sourcingId=`VS-${crypto.randomUUID().slice(0,10).toUpperCase()}`,cost=line.vendorQty*line.vendorUnitCost;stmts.push(db.prepare(`INSERT INTO vendor_sourcing (sourcing_id,sale_date,invoice_id,product_id,product_name,vendor_id,vendor_name,quantity,unit_cost,total_cost,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(sourcingId,date,invoiceId,line.product.product_id,line.product.product_name,line.vendor.vendor_id,line.vendor.vendor_name,line.vendorQty,line.vendorUnitCost,cost,user.fullName));stmts.push(db.prepare(`UPDATE vendors SET current_due=current_due+?,updated_at=datetime('now') WHERE vendor_id=?`).bind(cost,line.vendor.vendor_id));stmts.push(db.prepare(`INSERT INTO vendor_ledger (ledger_id,date,vendor_id,vendor_name,type,reference,debit,credit,balance,notes) VALUES (?,?,?,?, 'Sourcing', ?,?,0,(SELECT current_due FROM vendors WHERE vendor_id=?),?)`).bind(`VL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,date,line.vendor.vendor_id,line.vendor.vendor_name,sourcingId,cost,line.vendor.vendor_id,`Sourced ${line.vendorQty} x ${line.product.product_name} for Invoice ${invoiceId}`));}
    if(Number(line.product.track_warranty||0)&&Number(line.product.warranty_period_value||0)>0){const end=warrantyEndDate(date,line.product.warranty_period_value,line.product.warranty_period_unit);const serialDraws=line.trackingDraws.filter((t:any)=>t.serialId);if(serialDraws.length){for(const t of serialDraws)stmts.push(db.prepare(`INSERT INTO warranty_records (warranty_id,invoice_id,sale_date,product_id,product_name,customer_id,customer_name,customer_phone,serial_id,serial_number,quantity,remaining_quantity,warranty_end_date,status) VALUES (?,?,?,?,?,?,?,?,?,?,1,1,?,'Active')`).bind(`WAR-${crypto.randomUUID().slice(0,12).toUpperCase()}`,invoiceId,date,line.product.product_id,displayName,customerId,customerName,customerPhone,t.serialId,t.serialNumber||'',end));}else{stmts.push(db.prepare(`INSERT INTO warranty_records (warranty_id,invoice_id,sale_date,product_id,product_name,customer_id,customer_name,customer_phone,quantity,remaining_quantity,warranty_end_date,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'Active')`).bind(`WAR-${crypto.randomUUID().slice(0,12).toUpperCase()}`,invoiceId,date,line.product.product_id,displayName,customerId,customerName,customerPhone,line.q,line.q,end));}}
  }
  if(paidAmount>0){
    if(paymentMethod==='Bank'||paymentMethod==='Mobile Banking'){
      // Keep the stored bank-account balance and the bank ledger in the same
      // atomic D1 sale batch; old bank entries are never rewritten.
      stmts.push(db.prepare('UPDATE bank_accounts SET current_balance=current_balance+? WHERE bank_account_id=? AND status=\'Active\'')
        .bind(paidAmount,bankId));
      stmts.push(db.prepare(
        "INSERT INTO bank_book (entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) "+
        "VALUES (?,?,?,?, 'Sale',?,?,0,?,(SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),'Active',?,0)"
      ).bind(`BB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,bankId,bankName,date,invoiceId,
        `POS sale to ${customerName}`,paidAmount,bankId,user.fullName));
    }else stmts.push(db.prepare(`INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?, 'Sale',?,?,0,?,'Cash',0)`).bind(`CB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,date,invoiceId,`POS sale to ${customerName}`,paidAmount));
  }
  if(dueAmount>0){stmts.push(db.prepare(`UPDATE customers SET current_due=current_due+?,updated_at=datetime('now') WHERE customer_id=?`).bind(dueAmount,customerId));stmts.push(db.prepare(`INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) VALUES (?,?,?,?, 'Sale',?,?,0,(SELECT current_due FROM customers WHERE customer_id=?),'')`).bind(`CL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,date,customerId,customerName,invoiceId,dueAmount,customerId));}
  stmts.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'CREATE_SALE','SALE',?,?)`).bind(user.userId,invoiceId,`Total ${grandTotal}; paid ${paidAmount}; due ${dueAmount}`));
  try{await db.batch(stmts);}catch(err){
    // A concurrent duplicate request can lose the unique-index race.
    // The losing batch rolls back: return the committed invoice when available.
    if(requestId){
      const prior=await db.prepare('SELECT payload_sha256,invoice_id FROM pos_sale_requests WHERE request_id=?')
        .bind(requestId).first<{payload_sha256:string;invoice_id:string}>();
      if(prior){
        if(prior.payload_sha256!==fingerprint)return error('Sale request key was already used for different sale details.',409);
        return getInvoiceRoute(db,prior.invoice_id);
      }
    }
    if(String(err).includes('UNIT_PROFILE_CONFLICT'))return error('Unit conversion changed during checkout. Refresh and review the cart.',409);
    if(String(err).includes('POS_STOCK_CONFLICT'))return error('Stock changed during checkout. Reload POS and review available stock before retrying.',409);
    throw err;
  }
  return json({ok:true,invoice:{invoiceId,date,customerName,customerPhone,customerFatherName:cleanText(input.customerFatherName),customerAddress:cleanText(input.customerAddress),subtotal,discount,grandTotal,paidAmount,dueAmount,paymentStatus,paymentMethod,items:lines.map(l=>({productId:l.product.product_id,productName:(String(l.product.brand||'').trim()?`${String(l.product.brand).trim()} ${l.product.product_name}`:l.product.product_name),quantity:l.q,unit:l.product.unit||'',unitPrice:l.price,lineTotal:l.lineTotal,unitDescription:l.unitSnapshot?.description,unitSnapshot:l.unitSnapshot?{profile:l.unitSnapshot.profile,quantities:l.unitSnapshot.quantities,revision:l.unitSnapshot.revision}:undefined}))}});
}

export async function getSalesByPhoneRoute(db:SherDatabase,phone:string):Promise<Response>{const r=await db.prepare(`SELECT invoice_id,sale_date,grand_total,payment_status FROM sales WHERE customer_phone=? AND is_deleted=0 ORDER BY sale_date DESC,created_at DESC LIMIT 50`).bind(phone).all<any>();return json({ok:true,sales:(r.results||[]).map((s:any)=>({invoiceId:s.invoice_id,date:s.sale_date,grandTotal:Number(s.grand_total||0),paymentStatus:s.payment_status}))});}
export async function getInvoiceRoute(db:SherDatabase,id:string):Promise<Response>{
  const s=await db.prepare('SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0').bind(id).first<any>();
  if(!s)return error('Invoice not found.',404);
  const [items,snapshots]=await Promise.all([
    db.prepare(`SELECT si.product_id,si.product_name,si.quantity,si.unit_price,si.line_total,COALESCE(p.unit,'') unit
      FROM sale_items si LEFT JOIN products p ON p.product_id=si.product_id
      WHERE si.invoice_id=? ORDER BY si.id`).bind(id).all<any>(),
    db.prepare('SELECT product_id,profile_revision,profile_json,quantities_json,description FROM sale_item_unit_snapshots WHERE invoice_id=?')
      .bind(id).all<any>()
  ]);
  const snapshotMap=new Map((snapshots.results||[]).map((x:any)=>[x.product_id,x]));
  return json({ok:true,invoice:{invoiceId:s.invoice_id,date:s.sale_date,customerName:s.customer_name,
    customerPhone:s.customer_phone,customerFatherName:s.customer_father_name||'',customerAddress:s.customer_address,
    subtotal:Number(s.subtotal||0),discount:Number(s.discount||0),grandTotal:Number(s.grand_total||0),
    paidAmount:Number(s.paid_amount||0),dueAmount:Number(s.due_amount||0),paymentStatus:s.payment_status,
    paymentMethod:s.payment_method,items:(items.results||[]).map((i:any)=>{
      const snap:any=snapshotMap.get(i.product_id);
      return{productId:i.product_id,productName:i.product_name,quantity:Number(i.quantity),unit:i.unit||'',
        unitPrice:Number(i.unit_price),lineTotal:Number(i.line_total),
        ...(snap?{unitDescription:snap.description,unitSnapshot:{
          revision:snap.profile_revision,profile:JSON.parse(snap.profile_json),
          quantities:JSON.parse(snap.quantities_json)}}:{})};
    })}});
}

export async function getSalesManagementRoute(db:SherDatabase):Promise<Response>{
  const [sr,rr,ri,br,open]=await Promise.all([
    db.prepare(`SELECT invoice_id,sale_date,sale_time,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,payment_status,created_at FROM sales WHERE is_deleted=0 ORDER BY sale_date DESC,created_at DESC`).all<any>(),
    db.prepare(`SELECT invoice_id,COALESCE(SUM(total_return_amount),0) amount FROM sales_returns GROUP BY invoice_id`).all<any>(),
    db.prepare(`SELECT invoice_id,product_id,COALESCE(SUM(return_quantity),0) qty FROM sales_return_items GROUP BY invoice_id,product_id`).all<any>(),
    db.prepare(`SELECT bank_account_id,account_name,account_type FROM bank_accounts WHERE status='Active' ORDER BY account_name`).all<any>(),
    getOpenCashSession(db)
  ]);
  const retAmt=new Map<string,number>((rr.results||[]).map((r:any)=>[r.invoice_id,Number(r.amount||0)]));
  const returned=new Map<string,Map<string,number>>();for(const r of ri.results||[]){if(!returned.has(r.invoice_id))returned.set(r.invoice_id,new Map());returned.get(r.invoice_id)!.set(r.product_id,Number(r.qty||0));}
  const itemRows=await db.prepare(`SELECT invoice_id,product_id,COALESCE(SUM(quantity),0) qty FROM sale_items GROUP BY invoice_id,product_id`).all<any>();
  const sold=new Map<string,Map<string,number>>();for(const r of itemRows.results||[]){if(!sold.has(r.invoice_id))sold.set(r.invoice_id,new Map());sold.get(r.invoice_id)!.set(r.product_id,Number(r.qty||0));}
  const sales=(sr.results||[]).map((r:any)=>{
    const amt=retAmt.get(r.invoice_id)||0;let returnStatus='No Return';const soldMap=sold.get(r.invoice_id)||new Map();const retMap=returned.get(r.invoice_id)||new Map();
    if(amt>0){let full=true;for(const [pid,q] of soldMap){if((retMap.get(pid)||0)<q){full=false;break;}}returnStatus=full?'Fully Returned':'Partially Returned';}
    const editable=!!open && !amt && String(r.created_at||'')>=String(open.opened_at||'');
    return {invoiceId:r.invoice_id,date:r.sale_date,time:r.sale_time||'',customerId:r.customer_id||'',customerName:r.customer_name||'',customerPhone:r.customer_phone||'',grandTotal:Number(r.grand_total||0),paidAmount:Number(r.paid_amount||0),dueAmount:Number(r.due_amount||0),returnedAmount:amt,netSale:Number(r.grand_total||0)-amt,paymentStatus:r.payment_status||'Due',returnStatus,editable};
  });
  return json({ok:true,sales,bankAccounts:(br.results||[]).map((b:any)=>({id:b.bank_account_id,name:b.account_name,accountType:b.account_type||'Bank'}))});
}

export async function getSaleDetailRoute(db:SherDatabase,id:string):Promise<Response>{
  const s=await db.prepare(`SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0 LIMIT 1`).bind(id).first<any>();if(!s)return error('Invoice not found.',404);
  const [ir,ret]=await Promise.all([db.prepare(`SELECT product_id,product_name,quantity,unit_price,line_total FROM sale_items WHERE invoice_id=? ORDER BY id`).bind(id).all<any>(),db.prepare(`SELECT COALESCE(SUM(total_return_amount),0) amount FROM sales_returns WHERE invoice_id=?`).bind(id).first<any>()]);
  const returnedAmount=Number(ret?.amount||0);
  return json({ok:true,invoice:{invoiceId:s.invoice_id,date:s.sale_date,time:s.sale_time||'',customerId:s.customer_id||'',customerName:s.customer_name||'',customerPhone:s.customer_phone||'',customerAddress:s.customer_address||'',subtotal:Number(s.subtotal||0),discount:Number(s.discount||0),grandTotal:Number(s.grand_total||0),paidAmount:Number(s.paid_amount||0),dueAmount:Number(s.due_amount||0),returnedAmount,netSale:Number(s.grand_total||0)-returnedAmount,paymentStatus:s.payment_status,paymentMethod:s.payment_method||'',items:(ir.results||[]).map((i:any)=>({productId:i.product_id,name:i.product_name,qty:Number(i.quantity||0),unitPrice:Number(i.unit_price||0),lineTotal:Number(i.line_total||0)}))}});
}

export async function getSaleUpdateDataRoute(db:SherDatabase,id:string):Promise<Response>{
  const s=await db.prepare(`SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0 LIMIT 1`).bind(id).first<any>();if(!s)return error('Invoice not found.',404);
  const hasReturn=await db.prepare(`SELECT 1 x FROM sales_returns WHERE invoice_id=? LIMIT 1`).bind(id).first();if(hasReturn)return error('This invoice has Sales Return records and can no longer be updated. Use Sales Return for further corrections.');
  const open=await getOpenCashSession(db);if(!open||String(s.created_at||'')<String(open.opened_at||''))return error('This invoice belongs to a closed Cash Session and can no longer be edited. Please use Sales Return to make corrections.');
  const [items,vendors]=await Promise.all([db.prepare(`SELECT product_id,product_name,quantity,unit_price FROM sale_items WHERE invoice_id=? ORDER BY id`).bind(id).all<any>(),db.prepare(`SELECT product_id,vendor_id,vendor_name,quantity,unit_cost FROM vendor_sourcing WHERE invoice_id=?`).bind(id).all<any>()]);
  const vm=new Map<string,any>();for(const v of vendors.results||[])vm.set(v.product_id,v);
  return json({ok:true,sale:{invoiceId:s.invoice_id,date:s.sale_date,time:s.sale_time||'',customerId:s.customer_id||'',customerName:s.customer_name||'',customerPhone:s.customer_phone||'',customerAddress:s.customer_address||'',customerFatherName:s.customer_father_name||'',discount:Number(s.discount||0),paidAmount:Number(s.paid_amount||0),paymentMethod:s.payment_method||'',bankAccountId:s.bank_account_id||'',items:(items.results||[]).map((i:any)=>{const v=vm.get(i.product_id);return{productId:i.product_id,name:i.product_name,qty:Number(i.quantity||0),unitPrice:Number(i.unit_price||0),vendorId:v?.vendor_id||'',vendorName:v?.vendor_name||'',vendorUnitCost:Number(v?.unit_cost||0),vendorQty:Number(v?.quantity||0)}})}});
}

async function restoreSaleLotsPlan(db:SherDatabase,invoiceId:string,only?:Map<string,number>){
  const rows=await db.prepare(`SELECT sil.id,sil.product_id,sil.lot_id,sil.quantity,sl.original_quantity,sl.remaining_quantity,sl.source_type FROM sale_item_lots sil JOIN stock_lots sl ON sl.lot_id=sil.lot_id WHERE sil.invoice_id=? ORDER BY sil.id DESC`).bind(invoiceId).all<any>();
  const balances=new Map<string,{productId:string,lotId:string,current:number,original:number,sourceType:string,restore:number}>();
  const remainingNeed=only?new Map(only):null;
  for(const r of rows.results||[]){const maxNeed=remainingNeed?Number(remainingNeed.get(r.product_id)||0):Number(r.quantity||0);if(maxNeed<=0)continue;const take=Math.min(Number(r.quantity||0),maxNeed);if(take<=0)continue;const key=r.lot_id;let x=balances.get(key);if(!x)x={productId:r.product_id,lotId:r.lot_id,current:Number(r.remaining_quantity||0),original:Number(r.original_quantity||0),sourceType:r.source_type||'',restore:0};x.restore+=take;balances.set(key,x);if(remainingNeed)remainingNeed.set(r.product_id,maxNeed-take);}
  return balances;
}

/** FIFO lot restoration for mixed-unit returns: deduct allocations from prior returns,
 * not from the original sale repeatedly. An atomic INSERT trigger verifies each take. */
async function restoreMixedUnitLots(db:SherDatabase,invoiceId:string,needed:Map<string,number>) {
  const rows=await db.prepare(
    'SELECT sil.id,sil.product_id,sil.lot_id,sil.quantity,sl.original_quantity,sl.remaining_quantity,sl.source_type '+
    'FROM sale_item_lots sil JOIN stock_lots sl ON sl.lot_id=sil.lot_id '+
    'WHERE sil.invoice_id=? ORDER BY sil.id DESC'
  ).bind(invoiceId).all<any>();
  const previous=await db.prepare(
    'SELECT product_id,lot_id,SUM(quantity) total FROM sales_return_item_lots WHERE invoice_id=? GROUP BY product_id,lot_id'
  ).bind(invoiceId).all<any>();
  const restored=new Map((previous.results||[]).map((x:any)=>[x.product_id+'|'+x.lot_id,Number(x.total||0)]));
  const plan=new Map<string,{productId:string;lotId:string;current:number;original:number;sourceType:string;restore:number}>();
  const allocations:Array<{productId:string;lotId:string;quantity:number}>=[];
  const remaining=new Map(needed);
  for(const row of rows.results||[]) {
    let need=Number(remaining.get(row.product_id)||0);
    if(need<=0)continue;
    if(row.source_type==='OVERSOLD')throw new Error('Mixed-unit negative-sale lot cannot be partially returned in this workflow.');
    const already=restored.get(row.product_id+'|'+row.lot_id)||0;
    const capacity=Math.max(0,Number(row.quantity||0)-already);
    const take=Math.min(need,capacity);
    if(take<=0)continue;
    const key=String(row.lot_id);
    const entry=plan.get(key)||{
      productId:String(row.product_id),lotId:key,current:Number(row.remaining_quantity||0),
      original:Number(row.original_quantity||0),sourceType:String(row.source_type||''),restore:0
    };
    entry.restore+=take;plan.set(key,entry);
    allocations.push({productId:String(row.product_id),lotId:key,quantity:take});
    remaining.set(row.product_id,need-take);
  }
  for(const [productId,need] of remaining)if(need>0)
    throw new Error('Return stock lot history is incomplete for '+productId+'.');
  return{plan,allocations};
}

export async function receiveCustomerPaymentRoute(db:SherDatabase,input:any,user:AuthUser):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start your cash session in POS before receiving customer payments.');
  const customerId=cleanText(input.customerId),amount=Number(input.amount||0);
  const method=cleanText(input.method)||'Cash';
  if(!customerId||!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(Math.round(amount*100))||
     Math.abs(amount*100-Math.round(amount*100))>0.000001)
    return error('Enter a valid payment in whole poisha.');
  if(!['Cash','Bank','Mobile Banking'].includes(method))return error('Choose a supported payment method.');
  const c=await db.prepare('SELECT * FROM customers WHERE customer_id=? AND is_deleted=0')
    .bind(customerId).first<any>();
  if(!c)return error('Customer not found.');
  if(amount>Number(c.current_due||0)+0.000001)
    return error('Payment exceeds the outstanding customer due.',409);
  let bankId='',bankName='';
  if(method==='Bank'||method==='Mobile Banking'){
    bankId=cleanText(input.bankAccountId);
    if(!bankId)return error('Select a bank/mobile banking account.');
    const b=await db.prepare(
      "SELECT bank_account_id,account_name,account_type FROM bank_accounts WHERE bank_account_id=? AND status='Active'"
    ).bind(bankId).first<any>();
    if(!b||String(b.account_type||'Bank')!==method)
      return error('Matching active bank/mobile banking account not found.',409);
    bankName=String(b.account_name||'');
  }
  const ledgerId=`CL-${crypto.randomUUID().slice(0,10).toUpperCase()}`;
  const note=[cleanText(input.reference)?`Ref: ${cleanText(input.reference)}`:'',cleanText(input.note)]
    .filter(Boolean).join(' — ');
  const stmts:SqlPreparedStatement[]=[
    // The DB sees the CURRENT due during the atomic batch: if another concurrent
    // payment already spent it, NULL violates the NOT NULL constraint and rolls back.
    db.prepare("UPDATE customers SET current_due=CASE WHEN current_due>=? THEN ROUND(current_due-?,2) ELSE NULL END,updated_at=datetime('now') WHERE customer_id=? AND is_deleted=0")
      .bind(amount,amount,customerId),
    db.prepare("INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) VALUES (?,?,?,?, 'Payment','',0,?,(SELECT current_due FROM customers WHERE customer_id=?),?)")
      .bind(ledgerId,todayDate(),customerId,c.customer_name,amount,customerId,note)
  ];
  if(bankId){
    stmts.push(db.prepare(
      "UPDATE bank_accounts SET current_balance=CASE WHEN status='Active' THEN current_balance+? ELSE NULL END WHERE bank_account_id=?"
    ).bind(amount,bankId));
    stmts.push(db.prepare(
      "INSERT INTO bank_book (entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,created_by,is_deleted) "+
      "VALUES (?,?,?,?, 'Customer Payment',?,?,0,?,(SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),'Active',?,0)"
    ).bind(`BB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,bankId,bankName,todayDate(),ledgerId,
      `Payment from ${c.customer_name}`,amount,bankId,user.fullName));
  }else stmts.push(db.prepare(
    "INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?, 'Customer Payment',?,?,0,?,'Cash',0)"
  ).bind(`CB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,todayDate(),ledgerId,
    `Payment from ${c.customer_name}`,amount));
  stmts.push(db.prepare("INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'RECEIVE_CUSTOMER_PAYMENT','CUSTOMER',?,?)")
    .bind(user.userId,customerId,`Amount ${amount}`));
  try{await db.batch(stmts);}
  catch(e){
    if(/NOT NULL constraint failed|CONSTRAINT/i.test(String(e)))
      return error('Customer due or payment account changed. Reload before retrying.',409);
    throw e;
  }
  const committed=await db.prepare('SELECT current_due due FROM customers WHERE customer_id=?')
    .bind(customerId).first<{due:number}>();
  return json({ok:true,newDue:Number(committed?.due??0)});
}

/**
 * Full invoice reversal uses the existing atomic sales-return FIFO engine.
 * Only fully paid cash sales of untracked, own-stock mixed-unit lines are safe.
 * The original invoice/snapshots remain immutable for audit.
 */
async function planMixedSaleReversal(db:SherDatabase,id:string){
  const no=(reason:string)=>({eligible:false,reason,invoiceId:id,refundAmount:0,
    refundMethod:'Cash' as 'Cash'|'Bank'|'Mobile Banking'|'Due Adjustment',refundBankAccountId:'',refundAccountName:'',customerDueBefore:0,
    previouslyRefundedAmount:0,remainingBaseQuantity:0,
    items:[] as Array<{productId:string;qty:number;unitPrice:number;unitQuantities:Record<string,number>}>});
  const sale=await db.prepare('SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0')
    .bind(id).first<any>();
  if(!sale)return no('Invoice not found.');
  if(sale.status!=='Completed')return no('Only completed and unreversed invoices are eligible.');
  const cash=await getOpenCashSession(db);
  if(!cash)return no('Start a cash session first.');
  if(String(sale.created_at||'')<String(cash.opened_at||''))
    return no('Only invoices from this open cash session can be reversed. Use Sales Return for older invoices.');
  const isDueAdjustment=sale.payment_type==='Due';
  const refundMethod=(isDueAdjustment?'Due Adjustment':cleanText(sale.payment_method)) as
    'Cash'|'Bank'|'Mobile Banking'|'Due Adjustment';
  const bankRefund=refundMethod==='Bank'||refundMethod==='Mobile Banking';
  if(isDueAdjustment){
    if(Number(sale.paid_amount||0)!==0||Number(sale.due_amount||0)!==Number(sale.grand_total||0)||
       cleanText(sale.payment_method)||cleanText(sale.bank_account_id))
      return no('A due cancellation requires an entirely unpaid invoice without payment methods.');
  }else if(sale.payment_type!=='Cash'||!['Cash','Bank','Mobile Banking'].includes(refundMethod)||
      Number(sale.due_amount||0)!==0||
      Math.abs(Number(sale.paid_amount||0)-Number(sale.grand_total||0))>0.001)
    return no('Only fully paid cash, bank or mobile banking sales without customer due are eligible.');
  if(isDueAdjustment){
    const customerId=cleanText(sale.customer_id);
    if(!customerId)return no('This invoice is not linked to a customer ledger.');
    const customer=await db.prepare(
      'SELECT customer_id,current_due,is_deleted FROM customers WHERE customer_id=?'
    ).bind(customerId).first<any>();
    if(!customer||Number(customer.is_deleted)!==0||
       Math.round(Number(customer.current_due||0)*100)!==Math.round(Number(sale.grand_total||0)*100))
      return no('Customer due no longer equals this invoice. Reconcile customer ledger first.');
    const events=await db.prepare(
      'SELECT type,reference,debit,credit,balance FROM customer_ledger WHERE customer_id=?'
    ).bind(customerId).all<any>();
    if(events.results?.length!==1||
       events.results[0].type!=='Sale'||events.results[0].reference!==id||
       Math.round(Number(events.results[0].debit||0)*100)!==Math.round(Number(sale.grand_total||0)*100)||
       Number(events.results[0].credit||0)!==0||
       Math.round(Number(events.results[0].balance||0)*100)!==Math.round(Number(sale.grand_total||0)*100))
      return no('Customer ledger has payments, credits or other transactions. Cannot cancel due automatically.');
  }
  let refundBankAccountId='',refundAccountName='';
  if(bankRefund){
    refundBankAccountId=cleanText(sale.bank_account_id);
    const b=await db.prepare(
      'SELECT bank_account_id,account_name,account_type,opening_balance,current_balance,status '+
      'FROM bank_accounts WHERE bank_account_id=?'
    ).bind(refundBankAccountId).first<any>();
    if(!b||b.status!=='Active'||(cleanText(b.account_type)||'Bank')!==refundMethod)
      return no('Original bank/mobile account is missing, inactive or the wrong account type.');
    refundAccountName=cleanText(b.account_name);
    const entries=await db.prepare(
      "SELECT COUNT(*) n,COALESCE(SUM(credit),0) amount FROM bank_book "+
      "WHERE reference=? AND type='Sale' AND is_deleted=0 AND status='Active' "+
      "AND bank_account_id=? AND debit=0"
    ).bind(id,refundBankAccountId).first<{n:number;amount:number}>();
    if(Number(entries?.n)!==1||Math.round(Number(entries?.amount||0)*100)!==Math.round(Number(sale.paid_amount)*100))
      return no('Original bank/mobile sale payment cannot be reconciled to exactly one account entry.');
    const ledger=await db.prepare(
      "SELECT COALESCE(SUM(credit-debit),0) delta FROM bank_book WHERE bank_account_id=? AND is_deleted=0"
    ).bind(refundBankAccountId).first<{delta:number}>();
    const expectedBalance=Math.round((Number(b.opening_balance||0)+Number(ledger?.delta||0))*100)/100;
    if(Math.abs(expectedBalance-Number(b.current_balance||0))>0.005)
      return no('Bank/mobile account balance differs from its ledger. Reconcile it before refunding.');
  }
  if(await db.prepare('SELECT 1 AS x FROM vendor_sourcing WHERE invoice_id=? LIMIT 1').bind(id).first())
    return no('Vendor-sourced invoices require specialist settlement.');
  if(await db.prepare(
    'SELECT 1 AS x FROM sale_items i JOIN products p ON p.product_id=i.product_id '+
    'WHERE i.invoice_id=? AND (p.track_serial=1 OR p.track_expiry=1 OR p.track_warranty=1) LIMIT 1'
  ).bind(id).first())return no('Serial, expiry or warranty-tracked items require specialist returns.');
  if(await db.prepare(
    "SELECT 1 AS x FROM sale_item_lots sil JOIN stock_lots sl ON sl.lot_id=sil.lot_id "+
    "WHERE sil.invoice_id=? AND sl.source_type='OVERSOLD' LIMIT 1"
  ).bind(id).first())return no('Negative-stock invoice reversal is not supported.');
  if(!bankRefund&&!isDueAdjustment){
    const received=await db.prepare(
      "SELECT COALESCE(SUM(credit),0) n FROM cash_book WHERE reference=? AND type='Sale' AND is_deleted=0"
    ).bind(id).first<{n:number}>();
    if(Math.abs(Number(received?.n||0)-Number(sale.paid_amount||0))>0.001)
      return no('Original cash ledger cannot be reconciled.');
  }
  // Previously returned units are immutable. Only CASH refunds are eligible for
  // final cash reversal; store credits have separate outstanding customer liabilities.
  const history=await db.prepare(
    'SELECT return_id,refund_method,total_return_amount FROM sales_returns WHERE invoice_id=? ORDER BY created_at,return_id'
  ).bind(id).all<any>();
  const prior=history.results||[];
  if(bankRefund&&prior.length)return no('Bank/mobile full reversal requires zero previous returns. Reconcile prior refunds separately.');
  if(isDueAdjustment&&prior.length)return no('Due cancellation requires no previous returns or customer credits.');
  if(prior.some((r:any)=>r.refund_method!=='Cash'))
    return no('A previous return used Store Credit. Reconcile customer credit before reversing.');
  // Verify each historical cash refund has a live cash-book debit with the same
  // amount and no duplicate adjustment for this return ID.
  let priorRefundCents=0;
  for(const entry of prior){
    const cents=Math.round(Number(entry.total_return_amount||0)*100);
    if(!Number.isSafeInteger(cents)||cents<=0)return no('Previous return amount is invalid.');
    const cashRows=await db.prepare(
      "SELECT COUNT(*) n,COALESCE(SUM(debit),0) amount FROM cash_book WHERE type='Sales Return' AND reference=? AND is_deleted=0"
    ).bind(entry.return_id).first<{n:number;amount:number}>();
    if(Number(cashRows?.n||0)!==1||Math.round(Number(cashRows?.amount||0)*100)!==cents)
      return no('Previous return cash ledger does not reconcile.');
    priorRefundCents+=cents;
  }
  const dataResponse=await getSaleReturnDataRoute(db,id);
  const data=await dataResponse.json() as any;
  if(!data.ok)return no('Invoice return history could not be read.');
  if(!data.sale.items?.length)return no('No sale items found.');
  const subtotal=Number(sale.subtotal||0),grand=Number(sale.grand_total||0);
  const grandCents=Math.round(grand*100);
  if(subtotal<=0||grandCents<=0)return no('This invoice has no positive amount to reverse.');
  if(priorRefundCents>grandCents)
    return no('Earlier refunds exceed the original invoice total.');
  if(Math.round(Number(data.sale.previouslyReturnedAmount||0)*100)!==priorRefundCents)
    return no('Prior return summary does not reconcile to the cash ledger.');
  let refundCents=0,remainingBaseQuantity=0;
  const items:Array<{productId:string;qty:number;unitPrice:number;unitQuantities:Record<string,number>}>=[];
  for(const line of data.sale.items){
    if(!line.mixedUnit)return no('All items must have a saved mixed-unit snapshot.');
    const quantities=line.mixedUnit.availableQuantities as Record<string,number>;
    const profile=line.mixedUnit.profile as UnitProfile;
    // Cross-check that the remaining unit map and previously returned base units
    // reconcile exactly; no denomination substitution is allowed.
    let original:ReturnType<typeof quoteUnitQuantities>;
    try{original=quoteUnitQuantities(profile,line.mixedUnit.originalQuantities);}
    catch{return no('Original mixed-unit profile cannot be verified.');}
    if(original.baseQuantity!==Number(line.soldQty))
      return no('Original sale quantities do not match the frozen unit profile.');
    let base=0,partAmount=0;
    const nonzero=Object.fromEntries(Object.entries(quantities)
      .filter(([,count])=>Number(count)>0)) as Record<string,number>;
    if(Object.keys(nonzero).length){
      try{
        const quote=quoteUnitQuantities(profile,nonzero);
        base=quote.baseQuantity;
        partAmount=quote.lineTotal;
      }catch{return no('Remaining unit quantities cannot be verified.');}
    }
    if(base!==Number(line.availableQty)||base+Number(line.previouslyReturnedQty)!==Number(line.soldQty))
      return no('Previous returns and remaining unit quantities do not reconcile.');
    if(base>0){
      const cents=Math.round(partAmount*grand/subtotal*100);
      if(cents<=0)return no('Remaining refund amount is zero; use manual review.');
      refundCents+=cents;
      remainingBaseQuantity+=base;
      items.push({productId:line.productId,qty:base,unitPrice:0,unitQuantities:nonzero});
    }
  }
  if(!items.length)return no('Previous returns already cover the entire invoice.');
  if(refundCents+priorRefundCents!==grandCents)
    return no('Historical refund rounding does not reconcile to the original sale; manual review required.');
  return {eligible:true,reason:'',invoiceId:id,refundMethod,refundBankAccountId,refundAccountName,
    customerDueBefore:isDueAdjustment?Number(sale.grand_total||0):0,
    refundAmount:refundCents/100,previouslyRefundedAmount:priorRefundCents/100,
    remainingBaseQuantity,items};
}
export async function getMixedSaleReversalPreviewRoute(db:SherDatabase,id:string):Promise<Response>{
  const preview=await planMixedSaleReversal(db,id);
  return preview.reason==='Invoice not found.'?error(preview.reason,404):json({ok:true,preview});
}
export async function reverseMixedSaleRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  if(!(await hasModulePermission(db,user,'returns','add')))
    return error('Sales Returns permission is required to reverse an invoice.',403);
  const reason=cleanText(input?.reason);
  if(reason.length<8||reason.length>500)return error('Enter an 8–500 character reason for reversal.');
  const preview=await planMixedSaleReversal(db,id);
  if(!preview.eligible)return error(preview.reason||'Not eligible for full reversal.',409);
  return completeSalesReturnRoute(db,{
    invoiceId:id,refundMethod:preview.refundMethod,bankAccountId:preview.refundBankAccountId,
    reason,items:preview.items
  },user,true);
}

export async function getSaleReturnDataRoute(db:SherDatabase,id:string):Promise<Response>{
  const s=await db.prepare(`SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0`).bind(id).first<any>();
  if(!s)return error('Invoice not found.',404);
  if(s.status==='Reversed')return error('Invoice is already fully reversed.',409);
  const [items,ret,vend,unitSnapshots,priorUnitReturns]=await Promise.all([
    db.prepare(`SELECT product_id,product_name,SUM(quantity) sold_qty,MAX(unit_price) unit_price FROM sale_items WHERE invoice_id=? GROUP BY product_id,product_name`).bind(id).all<any>(),
    db.prepare(`SELECT product_id,SUM(return_quantity) qty FROM sales_return_items WHERE invoice_id=? GROUP BY product_id`).bind(id).all<any>(),
    db.prepare(`SELECT product_id,SUM(quantity) qty FROM vendor_sourcing WHERE invoice_id=? GROUP BY product_id`).bind(id).all<any>(),
    db.prepare('SELECT product_id,profile_json,quantities_json,description FROM sale_item_unit_snapshots WHERE invoice_id=?').bind(id).all<any>(),
    db.prepare('SELECT product_id,quantities_json FROM sales_return_item_units WHERE invoice_id=?').bind(id).all<any>()
  ]);
  const snapshots=new Map((unitSnapshots.results||[]).map((x:any)=>[x.product_id,x]));
  const returnedUnits=new Map<string,Record<string,number>>();
  for(const x of priorUnitReturns.results||[]){
    const data=returnedUnits.get(x.product_id)||{};
    for(const [name,q] of Object.entries(JSON.parse(x.quantities_json) as Record<string,number>))
      data[name]=(data[name]||0)+Number(q);
    returnedUnits.set(x.product_id,data);
  }
  const rm=new Map((ret.results||[]).map((r:any)=>[r.product_id,Number(r.qty||0)]));
  const vm=new Map((vend.results||[]).map((r:any)=>[r.product_id,Number(r.qty||0)]));
  const pr=await db.prepare(`SELECT COALESCE(SUM(total_return_amount),0) amount FROM sales_returns WHERE invoice_id=?`).bind(id).first<any>();
  const prev=Number(pr?.amount||0);
  const mapped:any[]=[];
  for(const i of items.results||[]){
    const sold=Number(i.sold_qty||0),vendor=Number(vm.get(i.product_id)||0),already=Number(rm.get(i.product_id)||0);
    const p=await db.prepare(`SELECT track_serial AS trackSerial,track_expiry AS trackExpiry,track_warranty AS trackWarranty FROM products WHERE product_id=?`).bind(i.product_id).first<any>();
    let availableQty=Math.max(0,sold-vendor-already),availableSerials:string[]=[];
    if(Number(p?.trackSerial||0)){
      const sr=await db.prepare(`SELECT sit.serial_number AS serialNumber FROM sale_item_tracking sit WHERE sit.invoice_id=? AND sit.product_id=? AND sit.serial_id IS NOT NULL AND sit.returned_quantity<sit.quantity ORDER BY sit.id`).bind(id,i.product_id).all<any>();
      availableSerials=(sr.results||[]).map((r:any)=>String(r.serialNumber)); availableQty=Math.min(availableQty,availableSerials.length);
    }
    const frozen:any=snapshots.get(i.product_id);
    const mixedUnit=frozen?(()=>{
      const original=JSON.parse(frozen.quantities_json) as Record<string,number>;
      const returned=returnedUnits.get(i.product_id)||{};
      const available=Object.fromEntries(Object.entries(original).map(([name,count])=>[name,Math.max(0,count-(returned[name]||0))]));
      return{profile:JSON.parse(frozen.profile_json) as UnitProfile,
        originalQuantities:original,availableQuantities:available,
        description:frozen.description,netPriceFactor:Number(s.grand_total||0)/(Number(s.subtotal)>0?Number(s.subtotal):1)};
    })():null;
    mapped.push({productId:i.product_id,name:i.product_name,soldQty:sold,vendorQty:vendor,previouslyReturnedQty:already,availableQty,unitPrice:Number(i.unit_price||0),...p,availableSerials,mixedUnit});
  }
  return json({ok:true,sale:{invoiceId:s.invoice_id,date:s.sale_date,customerId:s.customer_id||'',customerName:s.customer_name||'',customerPhone:s.customer_phone||'',grandTotal:Number(s.grand_total||0),paidAmount:Number(s.paid_amount||0),dueAmount:Number(s.due_amount||0),previouslyReturnedAmount:prev,netSale:Number(s.grand_total||0)-prev,items:mapped}});
}

export async function completeSalesReturnRoute(db:SherDatabase,input:any,user:AuthUser,authorizedReversal=false):Promise<Response>{
  if(!(await getOpenCashSession(db)))return error('Start your cash session first before recording a Sales Return.');
  const invoiceId=cleanText(input.invoiceId),refundMethod=cleanText(input.refundMethod),reason=cleanText(input.reason);
  if(!invoiceId)return error('No invoice selected.');
  const isBankRefund=refundMethod==='Bank'||refundMethod==='Mobile Banking';
  const isDueAdjustment=refundMethod==='Due Adjustment';
  if(!['Cash','Store Credit','Bank','Mobile Banking','Due Adjustment'].includes(refundMethod))
    return error('Choose a refund method.');
  if((isBankRefund||isDueAdjustment)&&!authorizedReversal)
    return error('Bank/mobile refunds and due cancellation require the audited full-invoice reversal workflow.',409);
  const returnDate=/^\d{4}-\d{2}-\d{2}$/.test(cleanText(input.date))?cleanText(input.date):todayDate(),backdated=returnDate<todayDate(),backdatedReason=cleanText(input.backdatedReason);
  if(backdated&&!backdatedReason)return error('A reason is required when dating a return in the past.');
  const backdatedDays=backdated?Math.max(0,daysSince(returnDate)):0;
  const dataResp=await getSaleReturnDataRoute(db,invoiceId),data:any=await dataResp.clone().json();if(!data.ok)return dataResp;
  const sale=data.sale,requested=Array.isArray(input.items)?input.items:[];if(!requested.length)return error('Select at least one product to return.');
  let total=0;const byId=new Map((sale.items||[]).map((i:any)=>[i.productId,i])),valid:any[]=[];
  for(const it of requested){
    const productId=cleanText(it.productId),q=Math.max(0,Math.round(Number(it.qty||0))),price=Number(it.unitPrice||0),av:any=byId.get(productId);
    if(!av)return error((cleanText(it.name)||'Product')+' was not part of this invoice.');
    if(!Number.isSafeInteger(Number(it.qty))||Number(it.qty)<=0)return error(av.name+': enter a whole-number return quantity.');
    if(q>Number(av.availableQty||0))return error(av.name+': only '+av.availableQty+' available to return.');
    let mixedReturn:null|{quantities:Record<string,number>;amount:number}=null;
    if(av.mixedUnit){
      if(av.trackSerial||av.trackExpiry)return error(av.name+': tracked mixed-unit returns need serial/expiry allocation and remain unavailable.',409);
      if(!it.unitQuantities||typeof it.unitQuantities!=='object'||Array.isArray(it.unitQuantities))
        return error(av.name+': choose quantities in the originally sold units.',409);
      let quote:ReturnType<typeof quoteUnitQuantities>;
      try{quote=quoteUnitQuantities(av.mixedUnit.profile,it.unitQuantities);}
      catch(e){return error(av.name+': '+(e instanceof Error?e.message:'invalid unit quantity'));}
      if(quote.baseQuantity!==q)return error(av.name+': base return quantity differs from selected units.');
      for(const [name,count] of Object.entries(it.unitQuantities as Record<string,number>)){
        if(count>Number(av.mixedUnit.availableQuantities[name]||0))
          return error(av.name+': insufficient original '+name+' available to return.',409);
      }
      const factor=Number(av.mixedUnit.netPriceFactor||0);
      if(!Number.isFinite(factor)||factor<0||factor>1.000001)return error('Invoice net price factor is invalid.');
      const amount=Math.round(quote.lineTotal*factor*100)/100;
      mixedReturn={quantities:it.unitQuantities,amount};
    }else if(it.unitQuantities!==undefined)return error(av.name+': this invoice has no mixed-unit snapshot.');
    if(!Number.isFinite(price)||price<0)return error(av.name+': invalid return price.');
    const serialNumbers=Array.from(new Set((Array.isArray(it.serialNumbers)?it.serialNumbers:[]).map((x:any)=>cleanText(x)).filter(Boolean)));
    if(Number(av.trackSerial||0)&&serialNumbers.length!==q)return error(`${av.name}: select exactly ${q} Serial / IMEI number(s) being returned.`);
    const amount=mixedReturn?mixedReturn.amount:Math.round(q*price*100)/100;
    valid.push({productId,name:av.name,q,price:mixedReturn?amount/q:price,amount,mixedReturn,serialNumbers,
      trackSerial:!!av.trackSerial,trackExpiry:!!av.trackExpiry,trackWarranty:!!av.trackWarranty});
    total+=amount;
  }
  total=Math.round(total*100)/100;
  if(total<=0)return error('Return amount must be greater than zero.');
  if(total>Number(sale.netSale||0)+0.000001)return error('Refund exceeds the remaining net invoice amount.',409);
  let customerId=cleanText(sale.customerId);
  if(refundMethod==='Store Credit'&&!customerId){const phone=cleanText(sale.customerPhone);if(!phone)return error('Store Credit requires a customer phone number.');const existing=await db.prepare(`SELECT customer_id FROM customers WHERE phone=? AND is_deleted=0 LIMIT 1`).bind(phone).first<any>();if(existing)customerId=existing.customer_id;else{customerId=`CUS-${crypto.randomUUID().slice(0,8).toUpperCase()}`;await db.prepare(`INSERT INTO customers (customer_id,customer_name,phone,current_due,status,is_deleted) VALUES (?,?,?,0,'Active',0)`).bind(customerId,cleanText(sale.customerName)||'Customer',phone).run();}}
  const returnId='SRT-'+crypto.randomUUID().slice(0,10).toUpperCase();
  const ordinaryNeed=new Map<string,number>(),mixedNeed=new Map<string,number>();
  for(const v of valid)if(!v.trackSerial&&!v.trackExpiry) {
    if(v.mixedReturn)mixedNeed.set(v.productId,v.q);
    else ordinaryNeed.set(v.productId,v.q);
  }
  // Ordinary and mixed-unit returns both require immutable original FIFO
  // allocations; otherwise reports cannot verify which historical cost was reversed.
  let ordinaryLots:{plan:Map<string,any>;allocations:Array<{productId:string;lotId:string;quantity:number}>}={
    plan:new Map(),allocations:[]
  };
  if(ordinaryNeed.size){
    try{ordinaryLots=await restoreMixedUnitLots(db,invoiceId,ordinaryNeed);}
    catch(e){return error(e instanceof Error?e.message:'Invalid return lots.',409);}
  }
  const ordinaryRestore=ordinaryLots.plan;
  let mixedLots:{plan:Map<string,any>;allocations:Array<{productId:string;lotId:string;quantity:number}>}={
    plan:new Map(),allocations:[]
  };
  if(mixedNeed.size){
    try{mixedLots=await restoreMixedUnitLots(db,invoiceId,mixedNeed);}
    catch(e){return error(e instanceof Error?e.message:'Invalid mixed return lots.',409);}
  }
  for(const [lotId,item] of mixedLots.plan){
    if(ordinaryRestore.has(lotId))return error('Mixed and ordinary returns share an ambiguous inventory lot.',409);
    ordinaryRestore.set(lotId,item);
  }
  const stmts:SqlPreparedStatement[]=[];
  const refundBankId=isBankRefund?cleanText(input.bankAccountId):'';
  let refundBankAccount:any=null;
  if(isBankRefund){
    const original=await db.prepare('SELECT payment_method,bank_account_id,grand_total,paid_amount,due_amount FROM sales WHERE invoice_id=?')
      .bind(invoiceId).first<any>();
    if(!original||original.payment_method!==refundMethod||refundBankId!==cleanText(original.bank_account_id)||
      Number(original.due_amount||0)!==0||Math.abs(Number(original.paid_amount)-Number(original.grand_total))>0.001)
      return error('Refund must use the original fully paid bank/mobile account.',409);
    refundBankAccount=await db.prepare(
      'SELECT bank_account_id,account_name,current_balance,account_type,status FROM bank_accounts WHERE bank_account_id=?'
    ).bind(refundBankId).first<any>();
    if(!refundBankAccount||refundBankAccount.status!=='Active'||
       (cleanText(refundBankAccount.account_type)||'Bank')!==refundMethod)
      return error('Original bank/mobile account is unavailable.',409);
  }
  stmts.push(db.prepare(`INSERT INTO sales_returns (return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason,notes,processed_by,is_backdated,backdated_days,backdated_reason,refund_bank_account_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(returnId,returnDate,invoiceId,customerId,cleanText(sale.customerName),cleanText(sale.customerPhone),refundMethod,total,reason,cleanText(input.notes),user.fullName,backdated?1:0,backdatedDays,backdatedReason,refundBankId));
  for(const v of valid){
    stmts.push(db.prepare(`INSERT INTO sales_return_items (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES (?,?,?,?,?,?,?)`).bind(returnId,invoiceId,v.productId,v.name,v.q,v.price,v.amount));
    if(v.mixedReturn)stmts.push(db.prepare(
      'INSERT INTO sales_return_item_units (return_id,invoice_id,product_id,quantities_json,base_quantity,line_total_cents) VALUES (?,?,?,?,?,?)'
    ).bind(returnId,invoiceId,v.productId,JSON.stringify(v.mixedReturn.quantities),v.q,Math.round(v.amount*100)));
    const prod=await db.prepare(`SELECT current_stock FROM products WHERE product_id=?`).bind(v.productId).first<any>(),newStock=Number(prod?.current_stock||0)+v.q;
    stmts.push(db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(newStock,v.productId));
    stmts.push(db.prepare(`INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?, 'Sales Return',?,0,?,?,NULL)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`,v.productId,v.q,newStock,returnId));
    if(v.trackSerial||v.trackExpiry){
      const rows=await db.prepare(`SELECT id,lot_id AS lotId,COALESCE(serial_id,'') AS serialId,serial_number AS serialNumber,COALESCE(expiry_batch_id,'') AS expiryBatchId,quantity,returned_quantity AS returnedQuantity FROM sale_item_tracking WHERE invoice_id=? AND product_id=? AND returned_quantity<quantity ORDER BY id`).bind(invoiceId,v.productId).all<any>();
      const available=rows.results||[];const lotAdd=new Map<string,number>(),batchAdd=new Map<string,number>();let need=v.q;
      if(v.trackSerial){
        for(const sn of v.serialNumbers){const row=available.find((r:any)=>String(r.serialNumber).toLocaleLowerCase()===sn.toLocaleLowerCase());if(!row)return error(`${v.name}: Serial / IMEI ${sn} is not available to return on this invoice.`);stmts.push(db.prepare(`UPDATE sale_item_tracking SET returned_quantity=quantity WHERE id=?`).bind(row.id));stmts.push(db.prepare(`UPDATE product_serials SET status='In Stock',sale_invoice_id='',returned_at=datetime('now'),updated_at=datetime('now') WHERE serial_id=?`).bind(row.serialId));lotAdd.set(row.lotId,(lotAdd.get(row.lotId)||0)+1);if(row.expiryBatchId)batchAdd.set(row.expiryBatchId,(batchAdd.get(row.expiryBatchId)||0)+1);stmts.push(db.prepare(`UPDATE warranty_records SET remaining_quantity=0,status='Returned',updated_at=datetime('now') WHERE invoice_id=? AND product_id=? AND serial_id=?`).bind(invoiceId,v.productId,row.serialId));need-=1;}
      }else{
        for(const row of available){if(need<=0)break;const avail=Math.max(0,Number(row.quantity||0)-Number(row.returnedQuantity||0)),take=Math.min(need,avail);if(take<=0)continue;stmts.push(db.prepare(`UPDATE sale_item_tracking SET returned_quantity=returned_quantity+? WHERE id=?`).bind(take,row.id));lotAdd.set(row.lotId,(lotAdd.get(row.lotId)||0)+take);if(row.expiryBatchId)batchAdd.set(row.expiryBatchId,(batchAdd.get(row.expiryBatchId)||0)+take);need-=take;}
        if(need>0)return error(`${v.name}: tracking history is incomplete for this return.`);
        if(v.trackWarranty)stmts.push(db.prepare(`UPDATE warranty_records SET remaining_quantity=MAX(0,remaining_quantity-?),status=CASE WHEN remaining_quantity-?<=0 THEN 'Returned' ELSE status END,updated_at=datetime('now') WHERE invoice_id=? AND product_id=? AND serial_id IS NULL`).bind(v.q,v.q,invoiceId,v.productId));
      }
      for(const [lotId,q] of lotAdd)stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=MIN(original_quantity,remaining_quantity+?),status='Active',updated_at=datetime('now') WHERE lot_id=?`).bind(q,lotId));
      for(const [batchId,q] of batchAdd)stmts.push(db.prepare(`UPDATE stock_expiry_batches SET remaining_quantity=MIN(original_quantity,remaining_quantity+?),updated_at=datetime('now') WHERE expiry_batch_id=?`).bind(q,batchId));
    }else if(v.trackWarranty){
      stmts.push(db.prepare(`UPDATE warranty_records SET remaining_quantity=MAX(0,remaining_quantity-?),status=CASE WHEN remaining_quantity-?<=0 THEN 'Returned' ELSE status END,updated_at=datetime('now') WHERE invoice_id=? AND product_id=? AND serial_id IS NULL`).bind(v.q,v.q,invoiceId,v.productId));
    }
  }
  for(const alloc of [...ordinaryLots.allocations,...mixedLots.allocations])stmts.push(db.prepare(
    'INSERT INTO sales_return_item_lots (return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,?,?,?,?)'
  ).bind(returnId,invoiceId,alloc.productId,alloc.lotId,alloc.quantity));
  for(const x of ordinaryRestore.values()){let next=x.current+x.restore;if(x.sourceType==='OVERSOLD')next=Math.min(0,next);else next=Math.min(x.original,next);stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=?,updated_at=datetime('now'),status=CASE WHEN ?>0 THEN 'Active' WHEN source_type='OVERSOLD' AND ?<0 THEN 'Oversold' ELSE 'Depleted' END WHERE lot_id=?`).bind(next,next,next,x.lotId));}
  if(refundMethod==='Cash')stmts.push(db.prepare(`INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?, 'Sales Return',?,?,?,0,'Cash',0)`).bind(`CB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,returnDate,returnId,`Cash refund for ${invoiceId}`,total));
  else if(isBankRefund){
    stmts.push(db.prepare(
      'UPDATE bank_accounts SET current_balance=current_balance-? WHERE bank_account_id=? AND status=\'Active\''
    ).bind(total,refundBankId));
    stmts.push(db.prepare(
      "INSERT INTO bank_book (entry_id,bank_account_id,bank_account_name,date,type,reference,description,debit,credit,balance,status,notes,reversal_of,created_by,is_deleted) "+
      "VALUES (?,?,?,?, 'Sales Return',?,?,?,0,(SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),'Active',?,?,?,0)"
    ).bind(`BB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,refundBankId,cleanText(refundBankAccount.account_name),
      returnDate,returnId,`Refund for ${invoiceId}`,total,refundBankId,reason,invoiceId,user.fullName));
  }
  else if(isDueAdjustment){
    const original=await db.prepare(
      'SELECT customer_id,grand_total,paid_amount,due_amount,payment_type FROM sales WHERE invoice_id=?'
    ).bind(invoiceId).first<any>();
    const customer=await db.prepare(
      'SELECT customer_name,current_due,is_deleted FROM customers WHERE customer_id=?'
    ).bind(customerId).first<any>();
    if(!original||original.payment_type!=='Due'||original.customer_id!==customerId||
       Number(original.paid_amount||0)!==0||
       Math.round(Number(original.due_amount||0)*100)!==Math.round(total*100)||
       Math.round(Number(original.grand_total||0)*100)!==Math.round(total*100)||
       !customer||Number(customer.is_deleted)!==0||
       Math.round(Number(customer.current_due||0)*100)!==Math.round(total*100))
      return error('Outstanding customer due no longer reconciles to the original invoice.',409);
    // Zero the exact original receivable; NEVER credit cash or bank for unpaid sales.
    stmts.push(db.prepare(
      'UPDATE customers SET current_due=0,updated_at=datetime(\'now\') WHERE customer_id=? AND current_due=?'
    ).bind(customerId,total));
    stmts.push(db.prepare(
      "INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) "+
      "VALUES (?,?,?,?, 'Sale Reversal',?,0,?,0,?)"
    ).bind(`CL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,
      returnDate,customerId,customer.customer_name,returnId,total,
      'Cancelled unpaid invoice '+invoiceId+'; '+reason));
  }
  else{const c=await db.prepare(`SELECT customer_name,current_due FROM customers WHERE customer_id=?`).bind(customerId).first<any>(),newDue=Number(c?.current_due||0)-total;stmts.push(db.prepare(`UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?`).bind(newDue,customerId));stmts.push(db.prepare(`INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) VALUES (?,?,?,?, 'Sales Return Credit',?,0,?,?,?)`).bind(`CL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,returnDate,customerId,c?.customer_name||sale.customerName,returnId,total,newDue,`Store credit for return ${returnId}`));}
  stmts.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'CREATE_SALES_RETURN','SALES_RETURN',?,?)`).bind(user.userId,returnId,`Invoice ${invoiceId}; amount ${total}${backdated?`; backdated ${returnDate}`:''}`));
  if(authorizedReversal){
    stmts.push(db.prepare('INSERT INTO sale_reversal_logs (invoice_id,return_id,refund_amount_cents,reason,reversed_by,refund_method,refund_bank_account_id) VALUES (?,?,?,?,?,?,?)')
      .bind(invoiceId,returnId,Math.round(total*100),reason,user.userId,refundMethod,refundBankId));
    stmts.push(db.prepare("UPDATE sales SET status='Reversed',updated_at=datetime('now') WHERE invoice_id=? AND status='Completed' AND is_deleted=0").bind(invoiceId));
    stmts.push(db.prepare("INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'REVERSE_MIXED_SALE','SALE',?,?)")
      .bind(user.userId,invoiceId,'Return '+returnId+'; '+(isDueAdjustment?'due cancelled ':refundMethod+' refund ')+total+'; reason '+reason));
  }
try{await db.batch(stmts);}catch(err){if(String(err).includes('DUE_REVERSAL_CONFLICT'))return error('Customer due or ledger changed. Reload before trying to cancel.',409);if(String(err).includes('SALE_REVERSAL_REFUND_ACCOUNT_CONFLICT'))return error('Refund or due-settlement ledger did not reconcile. Review before retry.',409);if(String(err).includes('SALE_REVERSAL_CONFLICT')||String(err).includes('UNIQUE constraint failed: sale_reversal_logs'))return error('Invoice was already reversed or changed.',409);if(String(err).includes('MIXED_RETURN_CONFLICT'))return error('Original unit quantities changed during return. Reload this invoice.',409);if(String(err).includes('SALES_RETURN_QUANTITY_CONFLICT'))return error('Return quantity changed during checkout. Refresh this invoice before retrying.',409);throw err;}return json({ok:true,returnId,totalReturnAmount:total});
}

export async function getSalesReturnHistoryRoute(db:SherDatabase):Promise<Response>{
  const r=await db.prepare(`SELECT return_id,return_date,invoice_id,customer_name,customer_phone,refund_method,total_return_amount,reason,notes,processed_by,is_backdated,backdated_reason,created_at FROM sales_returns ORDER BY return_date DESC,created_at DESC`).all<any>();
  return json({ok:true,returns:(r.results||[]).map((x:any)=>({
    returnId:x.return_id,returnDate:x.return_date,invoiceId:x.invoice_id,customerName:x.customer_name,customerPhone:x.customer_phone,
    refundMethod:x.refund_method,totalReturnAmount:Number(x.total_return_amount||0),reason:x.reason||'',notes:x.notes||'',
    processedBy:x.processed_by||'',isBackdated:!!x.is_backdated,backdatedReason:x.backdated_reason||'',createdAt:x.created_at
  }))});
}

export async function searchSalesInvoicesForReturnRoute(db:SherDatabase,url:URL):Promise<Response>{
  const q=cleanText(url.searchParams.get('q')).toLowerCase();
  if(!q)return json({ok:true,matches:[]});
  const like=`%${q}%`;
  const r=await db.prepare(`
    SELECT s.invoice_id,s.sale_date,s.customer_name,s.customer_phone,s.grand_total,s.payment_status,
      COALESCE((SELECT SUM(sr.total_return_amount) FROM sales_returns sr WHERE sr.invoice_id=s.invoice_id),0) returned_amount
    FROM sales s
    WHERE COALESCE(s.is_deleted,0)=0 AND s.status<>'Deleted'
      AND (lower(s.invoice_id) LIKE ? OR lower(COALESCE(s.customer_name,'')) LIKE ? OR lower(COALESCE(s.customer_phone,'')) LIKE ?)
    ORDER BY s.sale_date DESC,s.created_at DESC
    LIMIT 30
  `).bind(like,like,like).all<any>();
  return json({ok:true,matches:(r.results||[]).map((x:any)=>({
    invoiceId:x.invoice_id,date:x.sale_date,customerName:x.customer_name||'Walk-in Customer',customerPhone:x.customer_phone||'',
    grandTotal:Number(x.grand_total||0),paymentStatus:x.payment_status||'',returnStatus:Number(x.returned_amount||0)>0?'Has Return':'No Return'
  }))});
}

export async function getSalesReturnDetailRoute(db:SherDatabase,returnId:string):Promise<Response>{
  const h=await db.prepare(`SELECT return_id,return_date,invoice_id,customer_name,customer_phone,refund_method,total_return_amount,reason,notes,processed_by,is_backdated,backdated_reason,created_at FROM sales_returns WHERE return_id=? LIMIT 1`).bind(returnId).first<any>();
  if(!h)return error('Sales Return not found.',404);
  const i=await db.prepare(`SELECT product_id,product_name,return_quantity,return_price,line_total FROM sales_return_items WHERE return_id=? ORDER BY id`).bind(returnId).all<any>();
  return json({ok:true,detail:{
    header:{returnId:h.return_id,returnDate:h.return_date,invoiceId:h.invoice_id,customerName:h.customer_name||'',customerPhone:h.customer_phone||'',refundMethod:h.refund_method,totalReturnAmount:Number(h.total_return_amount||0),reason:h.reason||'',notes:h.notes||'',processedBy:h.processed_by||'',isBackdated:!!h.is_backdated,backdatedReason:h.backdated_reason||'',createdAt:h.created_at||''},
    items:(i.results||[]).map((x:any)=>({productId:x.product_id,productName:x.product_name,quantity:Number(x.return_quantity||0),unitPrice:Number(x.return_price||0),lineTotal:Number(x.line_total||0)}))
  }});
}
export async function deleteSaleRoute(db:SherDatabase,id:string,reason:string,user:AuthUser):Promise<Response>{
  if(!reason)return error('Enter a reason for deleting this invoice.');if(!(await getOpenCashSession(db)))return error('Start your cash session first before deleting a sales invoice.');const s=await db.prepare(`SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0`).bind(id).first<any>();if(!s)return error('Invoice not found.',404);const tracked=await db.prepare(`SELECT 1 x FROM sale_items si JOIN products p ON p.product_id=si.product_id WHERE si.invoice_id=? AND (p.track_serial=1 OR p.track_expiry=1) LIMIT 1`).bind(id).first();if(tracked)return error('Invoices containing Serial / Expiry tracked products cannot be deleted. Use Sales Return so serial and expiry history remains intact.');const hasReturn=await db.prepare(`SELECT 1 x FROM sales_returns WHERE invoice_id=? LIMIT 1`).bind(id).first();if(hasReturn)return error('This invoice has a Sales Return against it. Delete the return first, then delete the invoice.');
  const vendorRows=await db.prepare(`SELECT * FROM vendor_sourcing WHERE invoice_id=?`).bind(id).all<any>();const vendorQty=new Map<string,number>();for(const v of vendorRows.results||[])vendorQty.set(v.product_id,(vendorQty.get(v.product_id)||0)+Number(v.quantity||0));const items=await db.prepare(`SELECT product_id,product_name,SUM(quantity) qty FROM sale_items WHERE invoice_id=? GROUP BY product_id,product_name`).bind(id).all<any>();const ownNeed=new Map<string,number>();for(const i of items.results||[])ownNeed.set(i.product_id,Math.max(0,Number(i.qty||0)-Number(vendorQty.get(i.product_id)||0)));const restore=await restoreSaleLotsPlan(db,id,ownNeed),stmts:SqlPreparedStatement[]=[];
  for(const i of items.results||[]){const own=Math.max(0,Number(i.qty||0)-Number(vendorQty.get(i.product_id)||0));if(own<=0)continue;const p=await db.prepare(`SELECT current_stock FROM products WHERE product_id=?`).bind(i.product_id).first<any>(),newStock=Number(p?.current_stock||0)+own;stmts.push(db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(newStock,i.product_id));stmts.push(db.prepare(`INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?, 'Sale Deleted',?,0,?,?,NULL)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`,i.product_id,own,newStock,`Invoice ${id} deleted`));}
  for(const x of restore.values()){let next=x.current+x.restore;if(x.sourceType==='OVERSOLD')next=Math.min(0,next);else next=Math.min(x.original,next);stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=?,updated_at=datetime('now'),status=CASE WHEN ?>0 THEN 'Active' WHEN source_type='OVERSOLD' AND ?<0 THEN 'Oversold' ELSE 'Depleted' END WHERE lot_id=?`).bind(next,next,next,x.lotId));}
  for(const v of vendorRows.results||[]){const ven=await db.prepare(`SELECT current_due FROM vendors WHERE vendor_id=?`).bind(v.vendor_id).first<any>(),newDue=Number(ven?.current_due||0)-Number(v.total_cost||0);stmts.push(db.prepare(`UPDATE vendors SET current_due=?,updated_at=datetime('now') WHERE vendor_id=?`).bind(newDue,v.vendor_id));stmts.push(db.prepare(`DELETE FROM vendor_ledger WHERE reference=? AND type='Sourcing'`).bind(v.sourcing_id));}
  stmts.push(db.prepare(`DELETE FROM vendor_sourcing WHERE invoice_id=?`).bind(id));stmts.push(db.prepare(`UPDATE cash_book SET is_deleted=1 WHERE reference=?`).bind(id));stmts.push(db.prepare(`UPDATE bank_book SET is_deleted=1 WHERE reference=?`).bind(id));if(s.customer_id&&Number(s.due_amount||0)>0){const c=await db.prepare(`SELECT current_due FROM customers WHERE customer_id=?`).bind(s.customer_id).first<any>(),newDue=Number(c?.current_due||0)-Number(s.due_amount||0);stmts.push(db.prepare(`UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?`).bind(newDue,s.customer_id));stmts.push(db.prepare(`DELETE FROM customer_ledger WHERE reference=?`).bind(id));}
  stmts.push(db.prepare(`UPDATE sales SET is_deleted=1,status='Deleted',delete_reason=?,deleted_by=?,deleted_at=datetime('now'),updated_at=datetime('now') WHERE invoice_id=?`).bind(reason,user.userId,id));stmts.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'DELETE_SALE','SALE',?,?)`).bind(user.userId,id,reason));try{await db.batch(stmts);}catch(err){if(String(err).includes('SALE_ALREADY_DELETED'))return error('Invoice was already cancelled. Refresh the sales list.',409);throw err;}return json({ok:true});
}

export async function updateSaleRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  const reason=cleanText(input.reason);if(!reason)return error('Enter a reason for this update.');if(!(await getOpenCashSession(db)))return error('Start your cash session first.');const old=await db.prepare(`SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0`).bind(id).first<any>();if(!old)return error('Invoice not found.',404);if(await db.prepare('SELECT 1 AS x FROM sale_item_unit_snapshots WHERE invoice_id=? LIMIT 1').bind(id).first())return error('Mixed-unit invoice editing requires unit-aware history. Reverse the full invoice until editing is enabled.',409);const tracked=await db.prepare(`SELECT 1 x FROM sale_items si JOIN products p ON p.product_id=si.product_id WHERE si.invoice_id=? AND (p.track_serial=1 OR p.track_expiry=1) LIMIT 1`).bind(id).first();if(tracked)return error('Invoices containing Serial / Expiry tracked products cannot be edited. Use Sales Return and create a corrected sale.');const ret=await db.prepare(`SELECT 1 x FROM sales_returns WHERE invoice_id=? LIMIT 1`).bind(id).first();if(ret)return error('This invoice has Sales Return records and can no longer be updated. Use Sales Return for further corrections.');const open=await getOpenCashSession(db);if(!open||String(old.created_at||'')<String(open.opened_at||''))return error('This invoice belongs to a closed Cash Session and can no longer be edited.');
  const customerName=cleanText(input.customerName),customerPhone=cleanText(input.customerPhone);if(!customerName||!customerPhone)return error('Customer name and phone are required for every sale.');if(!Array.isArray(input.items)||!input.items.length)return error('Cart is empty.');
  const oldVendor=await db.prepare(`SELECT * FROM vendor_sourcing WHERE invoice_id=?`).bind(id).all<any>(),oldItems=await db.prepare(`SELECT product_id,SUM(quantity) qty FROM sale_items WHERE invoice_id=? GROUP BY product_id`).bind(id).all<any>();const oldVendorQty=new Map<string,number>();for(const v of oldVendor.results||[])oldVendorQty.set(v.product_id,(oldVendorQty.get(v.product_id)||0)+Number(v.quantity||0));const oldOwn=new Map<string,number>();for(const i of oldItems.results||[])oldOwn.set(i.product_id,Math.max(0,Number(i.qty||0)-Number(oldVendorQty.get(i.product_id)||0)));const restored=await restoreSaleLotsPlan(db,id,oldOwn);
  const lotRows=await db.prepare(`SELECT id,lot_id,product_id,original_quantity,remaining_quantity,unit_cost,supplier_id,source_type FROM stock_lots ORDER BY id`).all<any>();const lotsByProduct=new Map<string,any[]>();for(const l of lotRows.results||[]){const x={...l,balance:Number(l.remaining_quantity||0)};const r=restored.get(l.lot_id);if(r){x.balance=r.sourceType==='OVERSOLD'?Math.min(0,r.current+r.restore):Math.min(r.original,r.current+r.restore);}if(!lotsByProduct.has(l.product_id))lotsByProduct.set(l.product_id,[]);lotsByProduct.get(l.product_id)!.push(x);}
  let subtotal=0;const newLines:any[]=[];const seen=new Set<string>();for(let idx=0;idx<input.items.length;idx++){const it=input.items[idx],pid=cleanText(it.productId),q=Math.max(1,Math.round(Number(it.qty||0))),price=Number(it.unitPrice||0);if(!pid||!Number.isFinite(price)||price<0)return error(`Line ${idx+1}: invalid product/price.`);if(seen.has(pid))return error(`${cleanText(it.name)||'Product'} appears more than once.`);seen.add(pid);const p=await db.prepare(`SELECT * FROM products WHERE product_id=? AND is_deleted=0 AND status<>'Inactive'`).bind(pid).first<any>();if(!p)return error(`${cleanText(it.name)||pid} no longer exists.`);let need=q;const draws:any[]=[];for(const l of lotsByProduct.get(pid)||[]){if(need<=0)break;const avail=Math.max(0,Number(l.balance||0));const take=Math.min(need,avail);if(take>0){l.balance-=take;need-=take;draws.push({lot:l,take});}}let vendor=null,vendorQty=0,vendorUnitCost=0;const vid=cleanText(it.vendorId);if(vid){if(need<=0)return error(`${p.product_name}: there is no shortage to source from a vendor.`);vendor=await db.prepare(`SELECT * FROM vendors WHERE vendor_id=?`).bind(vid).first<any>();if(!vendor)return error(`${p.product_name}: vendor not found.`);vendorUnitCost=Number(it.vendorUnitCost||0);vendorQty=need;need=0;}if(need>0&&cleanText(it.fulfillmentMode)!=='negative')return error(`${p.product_name}: stock is short by ${need}. Choose Vendor Sourcing or Negative Stock.`);newLines.push({p,q,price,draws,vendor,vendorQty,vendorUnitCost,negativeQty:need,ownQty:q-vendorQty});subtotal+=q*price;}
  const discount=Math.max(0,Number(input.discount||0)),grandTotal=Math.max(0,subtotal-discount);let paid=0,due=0;if(input.paymentType==='Cash')paid=grandTotal;else if(input.paymentType==='Due')due=grandTotal;else{paid=Number(input.paidAmount||0);if(paid<=0||paid>=grandTotal)return error('Partial payment must be more than 0 and less than grand total.');due=grandTotal-paid;}const paymentStatus=due<=0?'Paid':paid>0?'Partial':'Due',method=paid>0?(cleanText(input.paymentMethod)||'Cash'):'',bankId=cleanText(input.bankAccountId);if(paid>0&&(method==='Bank'||method==='Mobile Banking')&&!bankId)return error('Select a bank/mobile banking account.');
  let customerId=cleanText(input.customerId);if(due>0){const ex=await db.prepare(`SELECT customer_id FROM customers WHERE phone=? AND is_deleted=0`).bind(customerPhone).first<any>();if(ex)customerId=ex.customer_id;else if(!customerId){customerId=`CUS-${crypto.randomUUID().slice(0,8).toUpperCase()}`;await db.prepare(`INSERT INTO customers (customer_id,customer_name,phone,father_name,address,current_due,status,is_deleted) VALUES (?,?,?,?,?,0,'Active',0)`).bind(customerId,customerName,customerPhone,cleanText(input.customerFatherName),cleanText(input.customerAddress)).run();}}
  const stmts:SqlPreparedStatement[]=[];for(const [lotId,r] of restored){const l=(lotsByProduct.get(r.productId)||[]).find((x:any)=>x.lot_id===lotId);if(l)stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=?,updated_at=datetime('now'),status=CASE WHEN ?>0 THEN 'Active' WHEN source_type='OVERSOLD' AND ?<0 THEN 'Oversold' ELSE 'Depleted' END WHERE lot_id=?`).bind(l.balance,l.balance,l.balance,lotId));}
  for(const l of newLines){for(const d of l.draws)stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=?,updated_at=datetime('now'),status=CASE WHEN ?>0 THEN 'Active' ELSE 'Depleted' END WHERE lot_id=?`).bind(d.lot.balance,d.lot.balance,d.lot.lot_id));}
  for(const [pid,oldQ] of oldOwn){const nl=newLines.find(x=>x.p.product_id===pid),newQ=nl?nl.ownQty:0,p=await db.prepare(`SELECT current_stock FROM products WHERE product_id=?`).bind(pid).first<any>(),next=Number(p?.current_stock||0)+oldQ-newQ;stmts.push(db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(next,pid));stmts.push(db.prepare(`INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?, 'Sale Update',?,?,?, ?,NULL)`).bind(`SM-${crypto.randomUUID().slice(0,10).toUpperCase()}`,pid,Math.max(0,oldQ-newQ),Math.max(0,newQ-oldQ),next,`Invoice ${id} updated`));}
  for(const nl of newLines.filter(x=>!oldOwn.has(x.p.product_id))){const p=await db.prepare(`SELECT current_stock FROM products WHERE product_id=?`).bind(nl.p.product_id).first<any>(),next=Number(p?.current_stock||0)-nl.ownQty;stmts.push(db.prepare(`UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?`).bind(next,nl.p.product_id));}
  for(const v of oldVendor.results||[]){const ven=await db.prepare(`SELECT current_due FROM vendors WHERE vendor_id=?`).bind(v.vendor_id).first<any>();stmts.push(db.prepare(`UPDATE vendors SET current_due=?,updated_at=datetime('now') WHERE vendor_id=?`).bind(Number(ven?.current_due||0)-Number(v.total_cost||0),v.vendor_id));stmts.push(db.prepare(`DELETE FROM vendor_ledger WHERE reference=?`).bind(v.sourcing_id));}
  stmts.push(db.prepare(`DELETE FROM vendor_sourcing WHERE invoice_id=?`).bind(id),db.prepare(`DELETE FROM sale_items WHERE invoice_id=?`).bind(id),db.prepare(`DELETE FROM sale_item_lots WHERE invoice_id=?`).bind(id),db.prepare(`UPDATE cash_book SET is_deleted=1 WHERE reference=?`).bind(id),db.prepare(`UPDATE bank_book SET is_deleted=1 WHERE reference=?`).bind(id),db.prepare(`DELETE FROM customer_ledger WHERE reference=?`).bind(id));
  if(old.customer_id&&Number(old.due_amount||0)>0){const c=await db.prepare(`SELECT current_due FROM customers WHERE customer_id=?`).bind(old.customer_id).first<any>();stmts.push(db.prepare(`UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?`).bind(Number(c?.current_due||0)-Number(old.due_amount||0),old.customer_id));}
  let bankName='';if(paid>0&&(method==='Bank'||method==='Mobile Banking')){const b=await db.prepare(`SELECT account_name FROM bank_accounts WHERE bank_account_id=? AND status='Active'`).bind(bankId).first<any>();if(!b)return error('Bank/mobile banking account not found.');bankName=b.account_name;}
  stmts.push(db.prepare(`UPDATE sales SET customer_id=?,customer_name=?,customer_phone=?,customer_address=?,customer_father_name=?,subtotal=?,discount=?,grand_total=?,paid_amount=?,due_amount=?,payment_type=?,payment_status=?,payment_method=?,bank_account_id=?,bank_account_name=?,updated_at=datetime('now') WHERE invoice_id=?`).bind(customerId,customerName,customerPhone,cleanText(input.customerAddress),cleanText(input.customerFatherName),subtotal,discount,grandTotal,paid,due,input.paymentType,paymentStatus,method,bankId,bankName,id));
  for(const nl of newLines){stmts.push(db.prepare(`INSERT INTO sale_items (invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)`).bind(id,nl.p.product_id,nl.p.product_name,nl.q,nl.price,nl.q*nl.price));for(const d of nl.draws)stmts.push(db.prepare(`INSERT INTO sale_item_lots (invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id) VALUES (?,?,?,?,?,?)`).bind(id,nl.p.product_id,d.lot.lot_id,d.take,Number(d.lot.unit_cost||0),d.lot.supplier_id||''));if(nl.negativeQty>0){const lotId=`LOT-${crypto.randomUUID().slice(0,10).toUpperCase()}`;stmts.push(db.prepare(`INSERT INTO stock_lots (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status) VALUES (?,?,'OVERSOLD',?,0,?,?,'Oversold')`).bind(lotId,nl.p.product_id,id,-nl.negativeQty,Number(nl.p.purchase_price||0)));stmts.push(db.prepare(`INSERT INTO sale_item_lots (invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id) VALUES (?,?,?,?,?,'')`).bind(id,nl.p.product_id,lotId,nl.negativeQty,Number(nl.p.purchase_price||0)));}if(nl.vendor){const sid=`VS-${crypto.randomUUID().slice(0,10).toUpperCase()}`,cost=nl.vendorQty*nl.vendorUnitCost,ven=await db.prepare(`SELECT current_due FROM vendors WHERE vendor_id=?`).bind(nl.vendor.vendor_id).first<any>(),newDue=Number(ven?.current_due||0)+cost;stmts.push(db.prepare(`INSERT INTO vendor_sourcing (sourcing_id,sale_date,invoice_id,product_id,product_name,vendor_id,vendor_name,quantity,unit_cost,total_cost,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(sid,old.sale_date,id,nl.p.product_id,nl.p.product_name,nl.vendor.vendor_id,nl.vendor.vendor_name,nl.vendorQty,nl.vendorUnitCost,cost,user.fullName));stmts.push(db.prepare(`UPDATE vendors SET current_due=?,updated_at=datetime('now') WHERE vendor_id=?`).bind(newDue,nl.vendor.vendor_id));stmts.push(db.prepare(`INSERT INTO vendor_ledger (ledger_id,date,vendor_id,vendor_name,type,reference,debit,credit,balance,notes) VALUES (?,?,?,?, 'Sourcing', ?,?,0,?,?)`).bind(`VL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,old.sale_date,nl.vendor.vendor_id,nl.vendor.vendor_name,sid,cost,newDue,`Sourced ${nl.vendorQty} x ${nl.p.product_name} for Invoice ${id}`));}}
  if(paid>0){if(method==='Bank'||method==='Mobile Banking')stmts.push(db.prepare(`INSERT INTO bank_book (entry_id,bank_account_id,date,type,reference,description,debit,credit,is_deleted) VALUES (?,?,?,'Sale',?,?,0,?,0)`).bind(`BB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,bankId,old.sale_date,id,`POS sale to ${customerName}`,paid));else stmts.push(db.prepare(`INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?, 'Sale',?,?,0,?,'Cash',0)`).bind(`CB-${crypto.randomUUID().slice(0,10).toUpperCase()}`,old.sale_date,id,`POS sale to ${customerName}`,paid));}
  if(due>0){const c=await db.prepare(`SELECT current_due FROM customers WHERE customer_id=?`).bind(customerId).first<any>(),newDue=Number(c?.current_due||0)+due;stmts.push(db.prepare(`UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?`).bind(newDue,customerId));stmts.push(db.prepare(`INSERT INTO customer_ledger (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes) VALUES (?,?,?,?, 'Sale',?,?,0,?,'')`).bind(`CL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,old.sale_date,customerId,customerName,id,due,newDue));}
  stmts.push(db.prepare(`INSERT INTO invoice_edit_logs (log_id,invoice_id,entity_type,reason,before_total,after_total,edited_by,created_at) VALUES (?,?,'SALE',?,?,?,?,datetime('now'))`).bind(`IEL-${crypto.randomUUID().slice(0,10).toUpperCase()}`,id,reason,Number(old.grand_total||0),grandTotal,user.fullName));
  await db.batch(stmts);return json({ok:true,invoice:{invoiceId:id,date:old.sale_date,customerName,customerPhone,customerFatherName:cleanText(input.customerFatherName),customerAddress:cleanText(input.customerAddress),subtotal,discount,grandTotal,paidAmount:paid,dueAmount:due,paymentStatus,paymentMethod:method,items:newLines.map(n=>({productId:n.p.product_id,productName:n.p.product_name,quantity:n.q,unit:n.p.unit||'',unitPrice:n.price,lineTotal:n.q*n.price}))}});
}
