import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import type {PosSaleInput} from './types.js';
import {planBundleCashSale} from './bundleCashPlan.service.js';

const fail=(message:string,status=400)=>Response.json({ok:false,error:message},{status});
const dateToday=()=>new Date().toISOString().slice(0,10);
async function fingerprint(input:PosSaleInput):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
 return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
type Prior={payload_sha256:string;invoice_id:string};
async function readPrior(db:SherDatabase,id:string){
 return db.prepare('SELECT payload_sha256,invoice_id FROM pos_sale_requests WHERE request_id=?').bind(id).first<Prior>();
}

/** Hidden guarded cash-only bundle posting, with no POS UI or unsafe return workflow enabled. */
export async function postBundleCashSale(db:SherDatabase,input:PosSaleInput,user:AuthUser):Promise<Response>{
 const key=input?.clientRequestId,name=input?.customerName,phone=input?.customerPhone;
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(key)||typeof name!=='string'||!name.trim()||
    typeof phone!=='string'||!phone.trim()||
    input.paymentType!=='Cash'||input.paymentMethod!=='Cash'||
    (input.discount!==undefined&&input.discount!==0)||
    input.bankAccountId||input.customerId||(input.date&&input.date!==dateToday())||
    input.backdatedReason)return fail('Guarded bundle sale needs a unique request key, buyer, current-date cash payment and no discount.');
 const hash=await fingerprint(input);
 const replay=async(row:Prior)=>{
  if(row.payload_sha256!==hash)return fail('Sale request key belongs to different details.',409);
  const sale=await db.prepare('SELECT invoice_id,grand_total FROM sales WHERE invoice_id=? AND is_deleted=0').bind(row.invoice_id)
    .first<{invoice_id:string;grand_total:number}>();
  return sale?Response.json({ok:true,replayed:true,invoiceId:row.invoice_id,grandTotal:sale.grand_total}):
    fail('Saved request lacks a valid invoice.',409);
 };
 const prior=await readPrior(db,key);
 if(prior)return replay(prior);
 const session=await db.prepare("SELECT session_id FROM cash_sessions WHERE status='Open' LIMIT 1").first();
 if(!session)return fail('Start the POS cash session before posting a bundle.',400);
 let plan:Awaited<ReturnType<typeof planBundleCashSale>>;
 try{plan=await planBundleCashSale(db,input);}catch(e){return fail(e instanceof Error?e.message:'Bundle source stock is invalid.',409);}
 const invoiceId='INV-BUNDLE-'+crypto.randomUUID(),date=dateToday(),total=plan.totalMinor/100;
 const stmts:SqlPreparedStatement[]=[
  db.prepare("INSERT INTO pos_sale_requests(request_id,payload_sha256,invoice_id) VALUES (?,?,?)").bind(key,hash,invoiceId),
  db.prepare("INSERT INTO sales (invoice_id,sale_date,sale_time,customer_id,customer_name,customer_phone,subtotal,discount,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method,status,created_by) VALUES (?,?,strftime('%H:%M:%S','now'),'',?,?,?,0,?,?,0,'Cash','Paid','Cash','Completed',?)")
   .bind(invoiceId,date,name.trim(),phone.trim(),total,total,total,user.fullName)
 ];
 for(const line of plan.lines)stmts.push(db.prepare("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)")
  .bind(invoiceId,line.productId,line.name,line.qty,line.price,line.lineMinor/100));
 for(const r of plan.recipes)stmts.push(db.prepare(
  "INSERT INTO sale_bundle_components(invoice_id,bundle_id,revision,component_id,quantity_per_set,sets_sold,component_quantity,unit_snapshot) VALUES (?,?,?,?,?,?,?,?)")
  .bind(invoiceId,r.bundleId,r.revision,r.componentId,r.perSet,r.sets,r.physicalQty,r.unit));
 for(const physical of plan.updates){
  stmts.push(db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? AND is_deleted=0 AND ABS(COALESCE((SELECT SUM(remaining_quantity) FROM stock_lots WHERE product_id=? AND source_type<>'OVERSOLD'),0)-?)<0.00000001 THEN ? ELSE json_extract('BUNDLE_STOCK_CONFLICT','$') END,updated_at=datetime('now') WHERE product_id=?")
   .bind(physical.stockBefore,physical.productId,physical.stockBefore,physical.stockAfter,physical.productId));
  for(const lot of physical.lots)stmts.push(db.prepare(
   "UPDATE stock_lots SET remaining_quantity=CASE WHEN remaining_quantity=? THEN ? ELSE json_extract('BUNDLE_FIFO_CONFLICT','$') END,updated_at=datetime('now'),status=CASE WHEN ?=0 THEN 'Depleted' ELSE 'Active' END WHERE product_id=? AND lot_id=?")
   .bind(lot.before,lot.after,lot.after,physical.productId,lot.lotId));
 }
 for(const draw of plan.draws){
  const moveId='SM-BUNDLE-'+crypto.randomUUID();
  stmts.push(db.prepare(
   "INSERT INTO sale_item_lots(invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id) VALUES (?,?,?,?,?,?)")
   .bind(invoiceId,draw.visibleId,draw.lotId,draw.qty,draw.unitCost,draw.supplierId));
  stmts.push(db.prepare(
   "INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,'Sale',0,?,(SELECT current_stock FROM products WHERE product_id=?),?,?)")
   .bind(moveId,draw.physicalId,draw.qty,draw.physicalId,'BUNDLE:'+invoiceId+':'+draw.visibleId,draw.lotId));
  stmts.push(db.prepare(
   "INSERT INTO bundle_sale_allocations(invoice_id,visible_product_id,component_id,lot_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?,?,?)")
   .bind(invoiceId,draw.visibleId,draw.physicalId,draw.lotId,moveId,draw.qty,draw.unitCost,draw.minor));
 }
 stmts.push(db.prepare(
  "INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,'Sale',?,?,0,?,'Cash',0)")
  .bind('CB-BUNDLE-'+crypto.randomUUID(),date,invoiceId,'POS cash bundle sale to '+name.trim(),total));
 stmts.push(db.prepare(
  "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'CREATE_SALE','SALE',?,?)")
  .bind(user.userId,invoiceId,'Guarded bundle cash; original FIFO cost (poisha) '+plan.costMinor));
 try{await db.batch(stmts);}
 catch{
  const committed=await readPrior(db,key);
  if(committed)return replay(committed);
  return fail('Cash posting or FIFO stock changed. The entire bundle sale was rolled back.',409);
 }
 return Response.json({ok:true,replayed:false,invoiceId,grandTotal:total,costMinor:plan.costMinor,
  items:plan.lines.map(line=>({productId:line.productId,quantity:line.qty,lineTotal:line.lineMinor/100}))});
}
