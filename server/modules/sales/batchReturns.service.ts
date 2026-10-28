import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';

type BatchItem = { productId?: string; qty?: number; unitPrice?: number };
type BatchInvoice = { invoiceId?: string; items?: BatchItem[] };
type BatchInput = {
  customerId?: string;
  invoices?: BatchInvoice[];
  refundMethod?: 'Cash' | 'Store Credit';
  date?: string;
  reason?: string;
  backdatedReason?: string;
  notes?: string;
};
type LotState = { lotId:string; productId:string; remaining:number; original:number; sourceType:string; restore:number };
const text = (x: unknown) => String(x ?? '').trim();
const roundMoney = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const bad = (error: string, status = 400) => Response.json({ok:false,error},{status});
const today = () => new Date().toISOString().slice(0,10);

export async function searchReturnCustomers(db: SherDatabase, url: URL): Promise<Response> {
  const query=text(url.searchParams.get('q'));
  if(query.length < 2) return Response.json({ok:true,customers:[]});
  const rows=await db.prepare(`SELECT c.customer_id AS id,c.customer_name AS name,c.phone,c.current_due AS currentDue,
      (SELECT count(*) FROM sales s WHERE s.customer_id=c.customer_id AND s.is_deleted=0) AS invoiceCount
      FROM customers c WHERE c.is_deleted=0 AND
      (c.customer_id LIKE ? OR c.customer_name LIKE ? OR c.phone LIKE ?)
      ORDER BY c.customer_name COLLATE NOCASE LIMIT 30`).bind(...Array(3).fill('%'+query+'%')).all();
  return Response.json({ok:true,customers:rows.results||[]});
}

export async function getCustomerReturnInvoices(db: SherDatabase, customerId: string): Promise<Response> {
  const customer=await db.prepare('SELECT customer_id,customer_name,phone FROM customers WHERE customer_id=? AND is_deleted=0').bind(customerId).first();
  if(!customer) return bad('Customer not found.',404);
  const rows=await db.prepare(`SELECT s.invoice_id AS invoiceId,s.sale_date AS date,s.grand_total AS grandTotal,
    s.paid_amount AS paidAmount,s.due_amount AS dueAmount,s.payment_status AS paymentStatus,
    COALESCE((SELECT SUM(ri.total_return_amount) FROM sales_returns ri WHERE ri.invoice_id=s.invoice_id),0) AS returnedAmount,
    (SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si WHERE si.invoice_id=s.invoice_id) -
    (SELECT COALESCE(SUM(sri.return_quantity),0) FROM sales_return_items sri WHERE sri.invoice_id=s.invoice_id) AS remainingQuantity
    FROM sales s WHERE s.customer_id=? AND s.is_deleted=0 ORDER BY s.sale_date DESC,s.created_at DESC LIMIT 300`).bind(customerId).all();
  return Response.json({ok:true,customer,invoices:rows.results||[]});
}

/** The first batch-posting slice deliberately excludes serial/expiry-tracked lines.
 * It never silently returns a tracked product without restoring its serial/expiry provenance.
 * Batch posting is one D1 atomic batch; each child keeps its own invoice-specific return ID.
 */
export async function completeSalesReturnBatchRoute(db: SherDatabase, input: BatchInput, user: AuthUser): Promise<Response> {
  const customerId=text(input.customerId),method=text(input.refundMethod),invoices=input.invoices;
  const date=text(input.date)||today(),reason=text(input.reason),backdatedReason=text(input.backdatedReason);
  if(!customerId) return bad('Select an existing customer before batching invoices.');
  if(!Array.isArray(invoices)||invoices.length<2||invoices.length>20) return bad('Select between 2 and 20 invoices.');
  if(method!=='Cash'&&method!=='Store Credit') return bad('Choose Cash or Store Credit for the whole batch.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||date>today()) return bad('Enter a valid return date up to today.');
  if(date<today()&&!backdatedReason) return bad('A reason is required for a backdated return.');
  if(!reason) return bad('Return reason is required.');
  const open=await db.prepare("SELECT session_id FROM cash_sessions WHERE status='Open' LIMIT 1").first();
  if(!open) return bad('Start your POS cash session before a Sales Return.');
  const customer=await db.prepare('SELECT customer_name,current_due FROM customers WHERE customer_id=? AND is_deleted=0').bind(customerId).first<{customer_name:string;current_due:number}>();
  if(!customer) return bad('Customer not found.');
  const seenInvoices=new Set<string>();
  const stockState=new Map<string,number>();
  const lotState=new Map<string,LotState>();
  const statements: SqlPreparedStatement[]=[];
  const results: {returnId:string;invoiceId:string;totalReturnAmount:number}[]=[];
  const batchId='SRTB-'+crypto.randomUUID().slice(0,12).toUpperCase();
  let totalLines=0,total=0,runningDue=Number(customer.current_due||0);
  for(const source of invoices) {
    const id=text(source.invoiceId);
    if(!id||seenInvoices.has(id)) return bad('Select distinct invoices; duplicates are not allowed.');
    seenInvoices.add(id);
    const sale=await db.prepare(`SELECT * FROM sales WHERE invoice_id=? AND customer_id=? AND is_deleted=0`).bind(id,customerId).first<any>();
    if(!sale) return bad(`Invoice ${id} does not belong to this customer or has been deleted.`);
    if(date<String(sale.sale_date)) return bad(`Return date cannot precede invoice ${id} sale date.`);
    const items=Array.isArray(source.items)?source.items:[];
    if(!items.length) return bad(`Select returned products for invoice ${id}.`);
    totalLines+=items.length;
    if(totalLines>100) return bad('A batch can contain at most 100 product lines.');
    const saved=await db.prepare('SELECT product_id,product_name,quantity,unit_price FROM sale_items WHERE invoice_id=?').bind(id).all<any>();
    const returns=await db.prepare('SELECT product_id,SUM(return_quantity) AS qty FROM sales_return_items WHERE invoice_id=? GROUP BY product_id').bind(id).all<any>();
    const sourced=await db.prepare('SELECT product_id,SUM(quantity) AS qty FROM vendor_sourcing WHERE invoice_id=? GROUP BY product_id').bind(id).all<any>();
    const prior=await db.prepare(`SELECT COALESCE(SUM(total_return_amount),0) AS total,
        COALESCE(SUM(CASE WHEN refund_method='Cash' THEN total_return_amount ELSE 0 END),0) AS cash
        FROM sales_returns WHERE invoice_id=?`).bind(id).first<{total:number;cash:number}>();
    const previously=new Map((returns.results||[]).map(r=>[r.product_id,Number(r.qty||0)]));
    const vend=new Map((sourced.results||[]).map(r=>[r.product_id,Number(r.qty||0)]));
    const basePrices=new Map<string,{name:string;quantity:number;price:number}>();
    for(const row of saved.results||[]) {
      const prev=basePrices.get(row.product_id);
      basePrices.set(row.product_id,{name:row.product_name,quantity:Number(row.quantity)+(prev?.quantity||0),price:Number(row.unit_price)});
    }
    const seenProducts=new Set<string>();
    const planned: {productId:string;name:string;qty:number;price:number;lotUpdates:Map<string,number>}[]=[];
    let invoiceTotal=0;
    for(const item of items){
      const pid=text(item.productId),q=Number(item.qty),listed=basePrices.get(pid);
      if(!pid||!listed||seenProducts.has(pid)) return bad(`Invoice ${id}: product not found or duplicated.`);
      seenProducts.add(pid);
      if(!Number.isSafeInteger(q)||q<=0) return bad(`Invoice ${id}: quantity must be a positive whole number.`);
      const available=listed.quantity-Number(previously.get(pid)||0)-Number(vend.get(pid)||0);
      if(q>available) return bad(`Invoice ${id}: ${listed.name} has only ${available} units available to return.`);
      const product=await db.prepare('SELECT current_stock,track_serial,track_expiry FROM products WHERE product_id=?').bind(pid).first<any>();
      if(!product) return bad(`Invoice ${id}: product no longer exists.`);
      if(product.track_serial||product.track_expiry) return bad(`Invoice ${id}: tracked products require single-invoice return until batch serial/expiry restoration is implemented.`);
      const subtotal=Number(sale.subtotal||0),grand=Number(sale.grand_total||0);
      const effectivePrice=roundMoney(listed.price*(subtotal>0?Math.min(1,grand/subtotal):1));
      const price=item.unitPrice===undefined?effectivePrice:Number(item.unitPrice);
      if(!Number.isFinite(price)||price<0||price>effectivePrice+0.001) return bad(`Invoice ${id}: return price must be between 0 and the original net unit price (${effectivePrice}).`);
      // Sale lot provenance: only exact source invoice + product; do not guess lots.
      const lotRows=await db.prepare(`SELECT l.lot_id AS lotId,l.product_id AS productId,l.original_quantity AS original,
        l.remaining_quantity AS remaining,l.source_type AS sourceType,sil.quantity AS consumed
        FROM sale_item_lots sil JOIN stock_lots l ON l.lot_id=sil.lot_id
        WHERE sil.invoice_id=? AND sil.product_id=? ORDER BY sil.id DESC`).bind(id,pid).all<any>();
      let outstanding=q;
      const updates=new Map<string,number>();
      for(const row of lotRows.results||[]){
        if(outstanding<=0) break;
        let lot=lotState.get(row.lotId);
        if(!lot){
          lot={lotId:row.lotId,productId:pid,original:Number(row.original),remaining:Number(row.remaining),sourceType:String(row.sourceType),restore:0};
          lotState.set(lot.lotId,lot);
        }
        const capacity=lot.sourceType==='OVERSOLD' ? Math.max(0,-lot.remaining) : Math.max(0,lot.original-lot.remaining);
        const take=Math.min(outstanding,Math.min(Number(row.consumed),capacity));
        if(take<=0) continue;
        lot.remaining+=take;
        lot.restore+=take;
        updates.set(lot.lotId,(updates.get(lot.lotId)||0)+take);
        outstanding-=take;
      }
      if(outstanding>0) return bad(`Invoice ${id}: insufficient exact stock-lot history to return ${listed.name} safely. Use the single-invoice workflow.`);
      planned.push({productId:pid,name:listed.name,qty:q,price,lotUpdates:updates});
      invoiceTotal=roundMoney(invoiceTotal+q*price);
      if(!stockState.has(pid)) stockState.set(pid,Number(product.current_stock||0));
    }
    if(invoiceTotal>roundMoney(Number(sale.grand_total||0)-Number(prior?.total||0))+0.001) return bad(`Invoice ${id}: return exceeds remaining sale value.`);
    if(method==='Cash'&&invoiceTotal>roundMoney(Number(sale.paid_amount||0)-Number(prior?.cash||0))+0.001) return bad(`Invoice ${id}: cash refund exceeds cash collected on this invoice.`);
    const returnId='SRT-'+crypto.randomUUID().slice(0,12).toUpperCase();
    const backdated=date<today(),backdatedDays=backdated?Math.round((Date.parse(today()+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000):0;
    statements.push(db.prepare(`INSERT INTO sales_returns
      (return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason,notes,processed_by,is_backdated,backdated_days,backdated_reason,batch_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(returnId,date,id,customerId,sale.customer_name,sale.customer_phone,method,invoiceTotal,reason,text(input.notes),user.fullName,backdated?1:0,backdatedDays,backdatedReason,batchId));
    for(const item of planned){
      statements.push(db.prepare(`INSERT INTO sales_return_items
        (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total)
        VALUES (?,?,?,?,?,?,?)`).bind(returnId,id,item.productId,item.name,item.qty,item.price,roundMoney(item.qty*item.price)));
      const stock=(stockState.get(item.productId)||0)+item.qty;
      stockState.set(item.productId,stock);
      statements.push(db.prepare("UPDATE products SET current_stock=current_stock+?,updated_at=datetime('now') WHERE product_id=?").bind(item.qty,item.productId));
      statements.push(db.prepare(`INSERT INTO stock_movements
        (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id)
        VALUES (?,?,'Sales Return',?,0,?,?,NULL)`).bind('SM-'+crypto.randomUUID().slice(0,12).toUpperCase(),item.productId,item.qty,stock,returnId));
    }
    if(method==='Cash') statements.push(db.prepare(`INSERT INTO cash_book
      (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted)
      VALUES (?,?,'Sales Return',?,?,?,0,'Cash',0)`).bind('CB-'+crypto.randomUUID().slice(0,12).toUpperCase(),date,returnId,`Refund for ${id}`,invoiceTotal));
    else{
      runningDue=roundMoney(runningDue-invoiceTotal);
      statements.push(db.prepare("UPDATE customers SET current_due=current_due-?,updated_at=datetime('now') WHERE customer_id=?").bind(invoiceTotal,customerId));
      statements.push(db.prepare(`INSERT INTO customer_ledger
        (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes)
        VALUES (?,?,?,?, 'Sales Return Credit',?,0,?,?,?)`).bind('CL-'+crypto.randomUUID().slice(0,12).toUpperCase(),date,customerId,customer.customer_name,returnId,invoiceTotal,runningDue,`Batch ${batchId}; source invoice ${id}`));
    }
    statements.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note)
      VALUES (?,'CREATE_SALES_RETURN','SALES_RETURN',?,?)`).bind(user.userId,returnId,`Batch ${batchId}; Invoice ${id}; refund ${invoiceTotal}`));
    total=roundMoney(total+invoiceTotal);
    results.push({returnId,invoiceId:id,totalReturnAmount:invoiceTotal});
  }
  // Every child is fully planned before any write; D1 executes these in one atomic batch.
  for(const lot of lotState.values()){
    statements.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=?,updated_at=datetime('now'),
      status=CASE WHEN ?>0 THEN 'Active' WHEN source_type='OVERSOLD' AND ?<0 THEN 'Oversold' ELSE 'Depleted' END WHERE lot_id=?`)
      .bind(lot.remaining,lot.remaining,lot.remaining,lot.lotId));
  }
  await db.batch(statements);
  return Response.json({ok:true,batchId,returns:results,totalReturnAmount:total,refundMethod:method});
}
