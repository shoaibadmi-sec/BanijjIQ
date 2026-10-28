import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';

const str=(v:unknown)=>String(v??'').trim();
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const uid=(x:string)=>x+crypto.randomUUID().slice(0,12).toUpperCase();
const fail=(message:string,status=400)=>Response.json({ok:false,error:message},{status});
type Lot = { id:string; productId:string; remaining:number; initial:number; original:number; source:string; capacity:number };
async function isOpen(db:SherDatabase){
  return db.prepare("SELECT opened_at FROM cash_sessions WHERE status='Open' ORDER BY opened_at DESC LIMIT 1").first<{opened_at:string}>();
}
export async function hasBundleSaleItem(db:SherDatabase,invoice:string):Promise<boolean>{
  return !!await db.prepare("SELECT 1 AS found FROM sale_items WHERE invoice_id=? AND sold_product_type='Bundle' LIMIT 1")
    .bind(invoice).first();
}
export async function hasBundleRequest(db:SherDatabase,invoice:string,input:any):Promise<boolean>{
  for(const row of Array.isArray(input?.items)?input.items:[]){
    const v=await db.prepare("SELECT sold_product_type AS type FROM sale_items WHERE invoice_id=? AND product_id=?")
      .bind(invoice,str(row.productId)).first<{type:string}>();
    if(v?.type==='Bundle')return true;
  }
  return false;
}
export async function completeBundleReturnRoute(db:SherDatabase,input:any,user:AuthUser):Promise<Response>{
  const open=await isOpen(db);if(!open)return fail('Start the POS cash session before returning a bundle.');
  const invoiceId=str(input.invoiceId),method=str(input.refundMethod),reason=str(input.reason);
  const today=new Date().toISOString().slice(0,10),date=str(input.date)||today;
  if(!invoiceId||!reason)return fail('Select an invoice and enter the return reason.');
  if(method!=='Cash'&&method!=='Store Credit')return fail('Choose Cash or Store Credit.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today)return fail('Invalid return date.');
  if(date<today&&!str(input.backdatedReason))return fail('A backdated return requires a reason.');
  const sale=await db.prepare("SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0").bind(invoiceId).first<any>();
  if(!sale)return fail('Invoice not found.',404);
  if(date<str(sale.sale_date))return fail('Return date cannot precede the original sale.');
  const rows=Array.isArray(input.items)?input.items:[];
  if(!rows.length||rows.length>30)return fail('Select 1–30 bundle products to return.');
  const sold=await db.prepare(`SELECT product_id,product_name,quantity,unit_price FROM sale_items
    WHERE invoice_id=? AND sold_product_type='Bundle'`).bind(invoiceId).all<any>();
  const soldById=new Map((sold.results||[]).map(v=>[String(v.product_id),v]));
  const already=await db.prepare(`SELECT product_id,SUM(return_quantity) AS returned FROM sales_return_items
    WHERE invoice_id=? GROUP BY product_id`).bind(invoiceId).all<any>();
  const alreadyById=new Map((already.results||[]).map(v=>[String(v.product_id),Number(v.returned||0)]));
  const used=new Set<string>(),planned:{id:string;name:string;sets:number;price:number}[]=[];
  const lots=new Map<string,Lot>(),stock=new Map<string,number>(),stockStart=new Map<string,number>();
  const restore:{bundleId:string;productId:string;lotId:string;qty:number}[]=[];
  let total=0;
  for(const row of rows){
    const id=str(row.productId),q=Number(row.qty),soldRow=soldById.get(id);
    if(!soldRow)return fail('This return supports complete bundle sets only. Return ordinary products separately.');
    if(used.has(id))return fail('Each bundle may appear only once per return.');
    used.add(id);
    if(!Number.isSafeInteger(q)||q<1||q>Number(soldRow.quantity)-Number(alreadyById.get(id)||0))
      return fail(`${soldRow.product_name}: select a positive number of remaining whole sets.`);
    const net=money(Number(soldRow.unit_price)*
      (Number(sale.subtotal)>0?Math.min(1,Number(sale.grand_total)/Number(sale.subtotal)):1));
    const price=row.unitPrice===undefined?net:Number(row.unitPrice);
    if(!Number.isFinite(price)||price<0||price>net+0.001)
      return fail(`${soldRow.product_name}: return price cannot exceed the original discounted net unit price (${net}).`);
    const recipe=await db.prepare(`SELECT component_id,quantity_per_set FROM sale_bundle_components
      WHERE invoice_id=? AND bundle_id=? ORDER BY id`).bind(invoiceId,id).all<any>();
    if(!recipe.results?.length)return fail(`${soldRow.product_name}: missing historic component recipe; return is blocked.`);
    for(const part of recipe.results){
      const pid=String(part.component_id),needed=q*Number(part.quantity_per_set);
      if(!Number.isSafeInteger(needed)||needed<1)return fail('Invalid historical bundle quantity.');
      const allocations=await db.prepare(`SELECT sil.lot_id,sil.quantity,sl.remaining_quantity,sl.original_quantity,sl.source_type
        FROM sale_item_lots sil JOIN stock_lots sl ON sl.lot_id=sil.lot_id
        WHERE sil.invoice_id=? AND sil.source_sale_product_id=? AND sil.product_id=?
        ORDER BY sil.id DESC`).bind(invoiceId,id,pid).all<any>();
      const previous=await db.prepare(`SELECT lot_id,SUM(quantity) AS qty FROM sale_return_bundle_lots
        WHERE invoice_id=? AND bundle_id=? AND component_id=? GROUP BY lot_id`)
        .bind(invoiceId,id,pid).all<any>();
      const previousByLot=new Map((previous.results||[]).map(v=>[String(v.lot_id),Number(v.qty||0)]));
      let remaining=needed;
      for(const a of allocations.results||[]){
        if(remaining<=0)break;
        let lot=lots.get(String(a.lot_id));
        if(!lot){
          const isOversold=String(a.source_type)==='OVERSOLD';
          lot={id:String(a.lot_id),productId:pid,remaining:Number(a.remaining_quantity),
            initial:Number(a.remaining_quantity),original:Number(a.original_quantity),source:String(a.source_type),
            capacity:isOversold?Math.max(0,-Number(a.remaining_quantity)):
              Math.max(0,Number(a.original_quantity)-Number(a.remaining_quantity))};
          lots.set(lot.id,lot);
        }
        const saleCapacity=Math.max(0,Number(a.quantity)-Number(previousByLot.get(lot.id)||0));
        const take=Math.min(remaining,saleCapacity,lot.capacity);
        if(take<=0)continue;
        remaining-=take;lot.capacity-=take;lot.remaining+=take;
        restore.push({bundleId:id,productId:pid,lotId:lot.id,qty:take});
      }
      if(remaining>0)return fail(`${soldRow.product_name}: unable to restore the exact source lots for ${pid}. No records have changed.`);
      if(!stock.has(pid)){
        const p=await db.prepare("SELECT current_stock AS n FROM products WHERE product_id=?").bind(pid).first<{n:number}>();
        if(!p)return fail(`Historic component ${pid} is missing.`);
        stock.set(pid,Number(p.n));stockStart.set(pid,Number(p.n));
      }
      stock.set(pid,Number(stock.get(pid))+needed);
    }
    planned.push({id,name:String(soldRow.product_name),sets:q,price});
    total=money(total+q*price);
  }
  const prior=await db.prepare(`SELECT COALESCE(SUM(total_return_amount),0) AS allReturn,
    COALESCE(SUM(CASE WHEN refund_method='Cash' THEN total_return_amount ELSE 0 END),0) AS cashReturn
    FROM sales_returns WHERE invoice_id=?`).bind(invoiceId).first<any>();
  if(total>money(Number(sale.grand_total)-Number(prior?.allReturn||0))+0.001)return fail('Refund exceeds the remaining invoice value.');
  if(method==='Cash'&&total>money(Number(sale.paid_amount)-Number(prior?.cashReturn||0))+0.001)
    return fail('Cash refund exceeds the money collected for this invoice.');
  const returnId=uid('SRT-'),backdated=date<today;
  const customerExisting=await db.prepare("SELECT customer_id,customer_name,current_due FROM customers WHERE phone=? AND is_deleted=0")
    .bind(str(sale.customer_phone)).first<any>();
  let customerId=str(customerExisting?.customer_id||sale.customer_id);
  const stmts:SqlPreparedStatement[]=[];
  if(method==='Store Credit'&&!customerExisting){
    if(!str(sale.customer_phone))return fail('Store Credit requires customer contact information.');
    customerId=uid('CUS-');
    stmts.push(db.prepare(`INSERT INTO customers (customer_id,customer_name,phone,father_name,address,current_due,status,is_deleted)
      VALUES (?,?,?,?,?,0,'Active',0)`).bind(customerId,str(sale.customer_name),str(sale.customer_phone),str(sale.customer_father_name),str(sale.customer_address)));
    stmts.push(db.prepare("UPDATE sales SET customer_id=? WHERE invoice_id=?").bind(customerId,invoiceId));
  }
  stmts.push(db.prepare(`INSERT INTO sales_returns
    (return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason,
     notes,processed_by,is_backdated,backdated_days,backdated_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
     .bind(returnId,date,invoiceId,customerId,str(sale.customer_name),str(sale.customer_phone),
        method,total,reason,str(input.notes),user.fullName,backdated?1:0,backdated?Math.round((Date.parse(today)-Date.parse(date))/86400000):0,str(input.backdatedReason)));
  for(const row of planned){
    stmts.push(db.prepare(`INSERT INTO sales_return_items
      (return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total,sold_product_type)
      VALUES (?,?,?,?,?,?,?,'Bundle')`).bind(returnId,invoiceId,row.id,row.name,row.sets,row.price,money(row.sets*row.price)));
  }
  for(const r of restore){
    stmts.push(db.prepare(`INSERT INTO sale_return_bundle_lots
      (return_id,invoice_id,bundle_id,component_id,lot_id,quantity) VALUES (?,?,?,?,?,?)`)
      .bind(returnId,invoiceId,r.bundleId,r.productId,r.lotId,r.qty));
    stmts.push(db.prepare(`INSERT INTO stock_movements
      (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id,source_sale_product_id)
      VALUES (?,?,'Sales Return',?,0,?,?,?,?)`)
      .bind(uid('SM-'),r.productId,r.qty,stock.get(r.productId),returnId,r.lotId,r.bundleId));
  }
  for(const lot of lots.values())
    stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=
      CASE WHEN remaining_quantity=? THEN ? ELSE NULL END,updated_at=datetime('now'),
      status=CASE WHEN ?>0 THEN 'Active' WHEN source_type='OVERSOLD' AND ?<0 THEN 'Oversold' ELSE 'Depleted' END
      WHERE lot_id=?`).bind(lot.initial,lot.remaining,lot.remaining,lot.remaining,lot.id));
  for(const [pid,after] of stock)
    stmts.push(db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? THEN ? ELSE NULL END,updated_at=datetime('now') WHERE product_id=?").bind(stockStart.get(pid),after,pid));
  if(method==='Cash')
    stmts.push(db.prepare(`INSERT INTO cash_book
      (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted)
      VALUES (?,?, 'Sales Return',?,?,?,0,'Cash',0)`).bind(uid('CB-'),date,returnId,`Bundle refund for ${invoiceId}`,total));
  else{
    const next=money(Number(customerExisting?.current_due||0)-total);
    stmts.push(db.prepare("UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?").bind(next,customerId));
    stmts.push(db.prepare(`INSERT INTO customer_ledger
      (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes)
      VALUES (?,?,?,?, 'Sales Return Credit',?,0,?,?,?)`)
      .bind(uid('CL-'),date,customerId,str(sale.customer_name),returnId,total,next,`Complete bundle sets returned from ${invoiceId}`));
  }
  stmts.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note)
    VALUES (?,'CREATE_SALES_RETURN','SALES_RETURN',?,?)`).bind(user.userId,returnId,`Full-set bundle return ${invoiceId}; total ${total}`));
  await db.batch(stmts);
  return Response.json({ok:true,returnId,totalReturnAmount:total});
}

export async function deleteBundleInvoiceRoute(db:SherDatabase,invoiceId:string,reason:string,user:AuthUser):Promise<Response>{
  if(!str(reason))return fail('A deletion reason is required.');
  const open=await isOpen(db);if(!open)return fail('Start the POS cash session.');
  const sale=await db.prepare("SELECT * FROM sales WHERE invoice_id=? AND is_deleted=0").bind(invoiceId).first<any>();
  if(!sale)return fail('Invoice not found.',404);
  if(String(sale.created_at)<String(open.opened_at))return fail('Cannot delete an invoice from a closed cash session.');
  if(await db.prepare("SELECT 1 FROM sales_returns WHERE invoice_id=? LIMIT 1").bind(invoiceId).first())
    return fail('Invoice has returns and cannot be deleted. Reverse the return first.');
  if(await db.prepare(`SELECT 1 FROM sale_items si JOIN products p ON p.product_id=si.product_id
    WHERE si.invoice_id=? AND (p.track_serial=1 OR p.track_expiry=1) LIMIT 1`).bind(invoiceId).first())
    return fail('Tracked invoices cannot be deleted.');
  const vendor=await db.prepare("SELECT 1 FROM vendor_sourcing WHERE invoice_id=? LIMIT 1").bind(invoiceId).first();
  if(vendor)return fail('Vendor sourcing requires its dedicated reversal workflow.');
  const lotRows=await db.prepare(`SELECT sil.product_id,sil.lot_id,sil.quantity,sl.remaining_quantity,
     sl.original_quantity,sl.source_type FROM sale_item_lots sil JOIN stock_lots sl ON sil.lot_id=sl.lot_id
    WHERE sil.invoice_id=? ORDER BY sil.id`).bind(invoiceId).all<any>();
  const byProduct=new Map<string,number>(),byLot=new Map<string,{remaining:number;original:number;source:string;restore:number}>();
  for(const row of lotRows.results||[]){
    const pid=String(row.product_id),lotId=String(row.lot_id),q=Number(row.quantity);
    byProduct.set(pid,Number(byProduct.get(pid)||0)+q);
    const s=byLot.get(lotId)||{remaining:Number(row.remaining_quantity),original:Number(row.original_quantity),source:String(row.source_type),restore:0};
    s.restore+=q;byLot.set(lotId,s);
  }
  const stmts:SqlPreparedStatement[]=[];
  for(const [id,record] of byLot){
    const next=record.source==='OVERSOLD'?Math.min(0,record.remaining+record.restore):
      Math.min(record.original,record.remaining+record.restore);
    if(next-record.remaining<record.restore-0.001)return fail('Lot restoration limit exceeded; deletion blocked to protect stock history.');
    stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=
      CASE WHEN remaining_quantity=? THEN ? ELSE NULL END,updated_at=datetime('now'),
      status=CASE WHEN ?>0 THEN 'Active' WHEN source_type='OVERSOLD' AND ?<0 THEN 'Oversold' ELSE 'Depleted' END
      WHERE lot_id=?`).bind(record.remaining,next,next,next,id));
  }
  for(const [pid,q] of byProduct){
    const row=await db.prepare("SELECT current_stock AS stock FROM products WHERE product_id=?").bind(pid).first<{stock:number}>();
    if(!row)return fail('Sale product missing from inventory.');
    const next=Number(row.stock)+q;
    stmts.push(db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? THEN ? ELSE NULL END,updated_at=datetime('now') WHERE product_id=?").bind(Number(row.stock),next,pid));
    stmts.push(db.prepare(`INSERT INTO stock_movements
      (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id)
      VALUES (?,?,'Sale Deleted',?,0,?,?,NULL)`).bind(uid('SM-'),pid,q,next,`Bundle invoice ${invoiceId} deleted`));
  }
  stmts.push(db.prepare("UPDATE cash_book SET is_deleted=1 WHERE reference=?").bind(invoiceId));
  stmts.push(db.prepare("UPDATE bank_book SET is_deleted=1 WHERE reference=?").bind(invoiceId));
  if(sale.customer_id&&Number(sale.due_amount||0)>0){
    const customer=await db.prepare("SELECT current_due FROM customers WHERE customer_id=?").bind(sale.customer_id).first<any>();
    if(!customer)return fail('Ledger customer is missing.');
    stmts.push(db.prepare("UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?")
      .bind(money(Number(customer.current_due)-Number(sale.due_amount)),sale.customer_id));
    stmts.push(db.prepare("DELETE FROM customer_ledger WHERE reference=? AND type='Sale'").bind(invoiceId));
  }
  stmts.push(db.prepare(`UPDATE sales SET is_deleted=1,status='Deleted',delete_reason=?,deleted_by=?,
    deleted_at=datetime('now'),updated_at=datetime('now') WHERE invoice_id=?`).bind(reason,user.userId,invoiceId));
  stmts.push(db.prepare(`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note)
    VALUES (?,'DELETE_SALE','SALE',?,?)`).bind(user.userId,invoiceId,`Bundle physical stock reversed: ${reason}`));
  await db.batch(stmts);
  return Response.json({ok:true});
}
