import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import {hasModulePermission} from '../auth/permissions.js';

type Input={clientRequestId?:unknown;reason?:unknown;productId?:unknown;qty?:unknown;[key:string]:unknown};
type Sale={invoice_id:string;status:string;is_deleted:number;payment_type:string;payment_method:string;
 grand_total:number;paid_amount:number;due_amount:number;discount:number;customer_id:string;customer_name:string;customer_phone:string};
type Line={product_id:string;product_name:string;quantity:number;unit_price:number;line_total:number;
 product_type:string;track_serial:number;track_expiry:number;track_warranty:number};
type Source={id:number;visible_product_id:string;component_id:string;lot_id:string;quantity:number;unit_cost:number;cost_minor:number};
type Lot={lot_id:string;remaining_quantity:number;original_quantity:number;unit_cost:number;source_type:string};
type Previous={return_id:string;invoice_id:string;product_id:string;quantity:number;payload_sha256:string};
type Draw={source:Source;take:number;costMinor:number};
const fail=(error:string,status=400)=>Response.json({ok:false,error},{status});
const today=()=>new Date().toISOString().slice(0,10);
function cents(n:unknown):number{
 if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw Error('Invalid original invoice amount.');
 const x=n*100,r=Math.round(x);
 if(!Number.isSafeInteger(r)||Math.abs(r-x)>0.000001)throw Error('Invoice amount has unsupported precision.');
 return r;
}
async function fingerprint(value:unknown):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function sumOriginalRefunds(db:SherDatabase,invoiceId:string,items:Line[]):Promise<number>{
 const linePrice=new Map(items.map(i=>[i.product_id,cents(i.unit_price)]));
 const [bundleR,ordinaryR,headersR,refundR]=await Promise.all([
  db.prepare('SELECT bundle_id,sets_returned FROM bundle_partial_return_requests WHERE invoice_id=?').bind(invoiceId)
   .all<{bundle_id:string;sets_returned:number}>(),
  db.prepare('SELECT product_id,quantity FROM bundle_ordinary_return_requests WHERE invoice_id=?').bind(invoiceId)
   .all<{product_id:string;quantity:number}>(),
  db.prepare('SELECT return_id FROM sales_returns WHERE invoice_id=?').bind(invoiceId).all<{return_id:string}>(),
  db.prepare("SELECT c.debit FROM cash_book c JOIN sales_returns r ON r.return_id=c.reference WHERE r.invoice_id=? AND c.type='Sales Return' AND c.is_deleted=0").bind(invoiceId)
   .all<{debit:number}>()
 ]);
 const bundle=bundleR.results??[],ordinary=ordinaryR.results??[];
 if((headersR.results??[]).length!==bundle.length+ordinary.length||
    (refundR.results??[]).length!==bundle.length+ordinary.length)
  throw Error('Prior refund headers or cash debits do not match their immutable request markers.');
 let expected=0;
 for(const row of [...bundle.map(r=>({id:r.bundle_id,qty:r.sets_returned})),...ordinary.map(r=>({id:r.product_id,qty:r.quantity}))]){
  const price=linePrice.get(row.id);
  if(price===undefined||!Number.isSafeInteger(row.qty)||row.qty<1)throw Error('Invalid recorded prior return quantity.');
  const total=price*row.qty;
  if(!Number.isSafeInteger(total))throw Error('Prior original-price refund overflow.');
  expected+=total;
 }
 let actual=0;
 for(const receipt of refundR.results??[])actual+=cents(Number(receipt.debit));
 if(expected!==actual)throw Error('Previously refunded bundle and ordinary cash do not reconcile.');
 return expected;
}

/** Strict cash-only ordinary Standard-line return from an immutable bundle/ordinary mixed cart. */
export async function returnOrdinaryBundleLine(db:SherDatabase,invoiceId:string,input:Input,user:AuthUser):Promise<Response>{
 if(!(await hasModulePermission(db,user,'returns','add')))return fail('Sales Returns permission required.',403);
 const requestId=input?.clientRequestId,reason=input?.reason,productId=input?.productId,qty=input?.qty;
 if(!invoiceId||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)||
    typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500||
    typeof productId!=='string'||!productId.trim()||
    typeof qty!=='number'||!Number.isSafeInteger(qty)||qty<1||qty>1000000||
    Object.keys(input||{}).some(k=>!['clientRequestId','reason','productId','qty'].includes(k)))
  return fail('Use a unique request key, original Standard product, whole quantity and 8–500 character reason.');
 const digest=await fingerprint({invoiceId,requestId,reason:reason.trim(),productId,qty});
 const prior=await db.prepare('SELECT return_id,invoice_id,product_id,quantity,payload_sha256 FROM bundle_ordinary_return_requests WHERE request_id=?')
  .bind(requestId).first<Previous>();
 const replay=async(row:Previous):Promise<Response>=>{
  if(row.invoice_id!==invoiceId||row.product_id!==productId||row.quantity!==qty||row.payload_sha256!==digest)
   return fail('This refund request key was already used for different details.',409);
  const r=await db.prepare('SELECT total_return_amount FROM sales_returns WHERE return_id=? AND invoice_id=?')
   .bind(row.return_id,row.invoice_id).first<{total_return_amount:number}>();
  return r?Response.json({ok:true,replayed:true,invoiceId,returnId:row.return_id,refundAmount:r.total_return_amount}):
   fail('Saved ordinary refund cannot be reconciled.',409);
 };
 if(prior)return replay(prior);
 const usedElsewhere=await Promise.all([
  db.prepare('SELECT 1 AS used FROM bundle_cash_return_requests WHERE request_id=?').bind(requestId).first(),
  db.prepare('SELECT 1 AS used FROM bundle_partial_return_requests WHERE request_id=?').bind(requestId).first()
 ]);
 if(usedElsewhere.some(Boolean))return fail('Refund request key was used on a different bundle return.',409);
 if(!(await db.prepare("SELECT 1 AS open FROM cash_sessions WHERE status='Open' LIMIT 1").first()))
  return fail('Start your cash session before a refund.');
 const sale=await db.prepare('SELECT invoice_id,status,is_deleted,payment_type,payment_method,grand_total,paid_amount,due_amount,discount,customer_id,customer_name,customer_phone FROM sales WHERE invoice_id=?')
  .bind(invoiceId).first<Sale>();
 if(!sale)return fail('Original cash invoice not found.',404);
 try{
  if(sale.status!=='Completed'||sale.is_deleted||sale.payment_type!=='Cash'||sale.payment_method!=='Cash'||
     Number(sale.due_amount)!==0||Number(sale.discount)!==0||cents(sale.grand_total)!==cents(sale.paid_amount))
   throw Error('Only unchanged, fully paid, cash-only invoices qualify.');
  const [linesR,bundleR,fullR,cashR,oldOrdinaryR,sourcesR,originalLotsR,mixedR]=await Promise.all([
   db.prepare("SELECT i.product_id,i.product_name,i.quantity,i.unit_price,i.line_total,p.product_type,p.track_serial,p.track_expiry,p.track_warranty FROM sale_items i JOIN products p ON p.product_id=i.product_id WHERE i.invoice_id=?")
    .bind(invoiceId).all<Line>(),
   db.prepare('SELECT 1 AS x FROM sale_bundle_components WHERE invoice_id=? LIMIT 1').bind(invoiceId).first(),
   db.prepare('SELECT 1 AS x FROM bundle_cash_return_requests WHERE invoice_id=? LIMIT 1').bind(invoiceId).first(),
   db.prepare("SELECT debit,credit FROM cash_book WHERE reference=? AND type='Sale' AND is_deleted=0").bind(invoiceId).all<{debit:number;credit:number}>(),
   db.prepare('SELECT product_id,quantity FROM bundle_ordinary_return_requests WHERE invoice_id=?').bind(invoiceId)
    .all<{product_id:string;quantity:number}>(),
   db.prepare('SELECT id,visible_product_id,component_id,lot_id,quantity,unit_cost,cost_minor FROM bundle_sale_allocations WHERE invoice_id=? AND visible_product_id=? ORDER BY id')
    .bind(invoiceId,productId).all<Source>(),
   db.prepare('SELECT lot_id,quantity,unit_cost FROM sale_item_lots WHERE invoice_id=? AND product_id=?')
    .bind(invoiceId,productId).all<{lot_id:string;quantity:number;unit_cost:number}>(),
   db.prepare('SELECT 1 AS x FROM sale_item_unit_snapshots WHERE invoice_id=? AND product_id=? LIMIT 1')
    .bind(invoiceId,productId).first()
  ]);
  const lines=linesR.results??[],line=lines.find(x=>x.product_id===productId),sources=sourcesR.results??[];
  if(!bundleR||fullR||!line||line.product_type!=='Standard'||line.track_serial||line.track_expiry||
     line.track_warranty||mixedR||!sources.length||cashR.results?.length!==1||
     Number(cashR.results[0]?.debit)!==0||cents(Number(cashR.results[0]?.credit))!==cents(sale.paid_amount))
   throw Error('Only an ordinary untracked Standard line from a guarded mixed-cart cash invoice is returnable.');
  let gross=0;const ids=new Set<string>();
  for(const item of lines){
   if(ids.has(item.product_id)||!Number.isSafeInteger(item.quantity)||item.quantity<1||
      cents(item.line_total)!==item.quantity*cents(item.unit_price))
    throw Error('Original visible invoice line and price history is inconsistent.');
   ids.add(item.product_id);gross+=cents(item.line_total);
  }
  if(gross!==cents(sale.grand_total))throw Error('Original invoice gross cash amount does not reconcile.');
  const priorQty=(oldOrdinaryR.results??[]).filter(x=>x.product_id===productId).reduce((n,x)=>n+x.quantity,0);
  if(priorQty+qty>line.quantity)throw Error('Return quantity exceeds unreturned original ordinary units.');
  const alreadyPaid=await sumOriginalRefunds(db,invoiceId,lines);
  const refundMinor=qty*cents(line.unit_price);
  if(!Number.isSafeInteger(refundMinor)||refundMinor<=0||refundMinor+alreadyPaid>cents(sale.grand_total))
   throw Error('Ordinary cash refund exceeds remaining original invoice amount.');
  const originalMap=new Map((originalLotsR.results??[]).map(x=>[x.lot_id,x]));
  const originalQty=new Map<string,number>();
  for(const source of sources){
   const original=originalMap.get(source.lot_id);
   if(source.component_id!==productId||source.visible_product_id!==productId||
      !original||original.unit_cost!==source.unit_cost||
      !Number.isSafeInteger(source.quantity)||source.quantity<1||
      cents(source.quantity*source.unit_cost)!==source.cost_minor)
    throw Error('Original ordinary physical FIFO allocation is incomplete.');
   originalQty.set(source.lot_id,(originalQty.get(source.lot_id)||0)+source.quantity);
  }
  for(const original of originalLotsR.results??[])
   if(originalQty.get(original.lot_id)!==original.quantity)
    throw Error('Saved ordinary sale lots differ from source allocations.');
  if(sources.reduce((n,s)=>n+s.quantity,0)!==line.quantity)
   throw Error('Ordinary line lacks original physical FIFO source quantity.');
  const restored=await db.prepare('SELECT source_allocation_id,SUM(quantity) restored FROM bundle_partial_return_allocations WHERE invoice_id=? AND visible_product_id=? GROUP BY source_allocation_id')
   .bind(invoiceId,productId).all<{source_allocation_id:number;restored:number}>();
  const restoredBySource=new Map((restored.results??[]).map(x=>[x.source_allocation_id,x.restored]));
  const draws:Draw[]=[];let remaining=qty;
  for(const source of sources){
   const restoredQty=Number(restoredBySource.get(source.id)??0);
   if(!Number.isSafeInteger(restoredQty)||restoredQty<0||restoredQty>source.quantity)
    throw Error('Original source has invalid historical return quantity.');
   const take=Math.min(remaining,source.quantity-restoredQty);
   if(take>0){draws.push({source,take,costMinor:cents(take*source.unit_cost)});remaining-=take;}
  }
  if(remaining!==0)throw Error('Original ordinary source lots are insufficient for this return.');
  const product=await db.prepare('SELECT product_type,current_stock,is_deleted FROM products WHERE product_id=?')
   .bind(productId).first<{product_type:string;current_stock:number;is_deleted:number}>();
  if(!product||product.product_type!=='Standard'||product.is_deleted)
   throw Error('Original ordinary product is unavailable.');
  const lotRows=await db.prepare('SELECT lot_id,original_quantity,remaining_quantity,unit_cost,source_type FROM stock_lots WHERE product_id=?')
   .bind(productId).all<Lot>();
  const lots=new Map<string,Lot>(),physical=(lotRows.results??[]).reduce((sum,l)=>sum+Number(l.source_type==='OVERSOLD'?0:l.remaining_quantity),0);
  for(const lot of lotRows.results??[]){
   if(lot.source_type==='OVERSOLD'||lot.original_quantity<lot.remaining_quantity||lot.remaining_quantity<0)
    throw Error('Original physical FIFO stock is inconsistent.');
   lots.set(lot.lot_id,lot);
  }
  if(Math.abs(physical-product.current_stock)>0.00000001)throw Error('Original stock lots differ from master quantity.');
  for(const [lotId,lot] of lots){
   const total=draws.filter(x=>x.source.lot_id===lotId).reduce((s,x)=>s+x.take,0);
   if(lot.remaining_quantity+total>lot.original_quantity)
    throw Error('Restoring ordinary source would exceed the original FIFO lot.');
  }
  const returnId='SRT-BORD-'+crypto.randomUUID(),refund=refundMinor/100;
  const stmts:SqlPreparedStatement[]=[
   db.prepare('INSERT INTO bundle_ordinary_return_requests(request_id,return_id,invoice_id,product_id,quantity,payload_sha256) VALUES (?,?,?,?,?,?)')
    .bind(requestId,returnId,invoiceId,productId,qty,digest),
   db.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason,processed_by) VALUES (?,?,?,?,?,?,'Cash',?,?,?)")
    .bind(returnId,today(),invoiceId,sale.customer_id,sale.customer_name,sale.customer_phone,refund,reason.trim(),user.fullName),
   db.prepare('INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES (?,?,?,?,?,?,?)')
    .bind(returnId,invoiceId,productId,line.product_name,qty,line.unit_price,refund),
   db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? AND is_deleted=0 AND ABS(COALESCE((SELECT SUM(remaining_quantity) FROM stock_lots WHERE product_id=? AND source_type<>'OVERSOLD'),0)-?)<0.00000001 THEN ? ELSE json_extract('ORDINARY_RETURN_STOCK_CONFLICT','$') END,updated_at=datetime('now') WHERE product_id=?")
    .bind(product.current_stock,productId,product.current_stock,product.current_stock+qty,productId)
  ];
  for(const [lotId,lot] of lots){
   const added=draws.filter(d=>d.source.lot_id===lotId).reduce((sum,d)=>sum+d.take,0);
   if(!added)continue;
   const next=lot.remaining_quantity+added;
   stmts.push(db.prepare("UPDATE stock_lots SET remaining_quantity=CASE WHEN remaining_quantity=? AND original_quantity>=? THEN ? ELSE json_extract('ORDINARY_RETURN_FIFO_CONFLICT','$') END,updated_at=datetime('now'),status='Active' WHERE lot_id=? AND product_id=?")
    .bind(lot.remaining_quantity,next,next,lotId,productId));
  }
  let running=product.current_stock;const lotAmounts=new Map<string,number>();let costMinor=0;
  for(const draw of draws){
   running+=draw.take;costMinor+=draw.costMinor;
   const move='SM-BORD-'+crypto.randomUUID();
   stmts.push(db.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,'Sales Return',?,0,?,?,?)")
    .bind(move,productId,draw.take,running,'BUNDLE ORDINARY RETURN:'+invoiceId+':'+productId,draw.source.lot_id));
   stmts.push(db.prepare('INSERT INTO bundle_partial_return_allocations(return_id,invoice_id,visible_product_id,component_id,lot_id,source_allocation_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(returnId,invoiceId,productId,productId,draw.source.lot_id,draw.source.id,move,draw.take,draw.source.unit_cost,draw.costMinor));
   lotAmounts.set(draw.source.lot_id,(lotAmounts.get(draw.source.lot_id)||0)+draw.take);
  }
  for(const [lotId,q] of lotAmounts)stmts.push(db.prepare('INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,?,?,?,?)')
   .bind(returnId,invoiceId,productId,lotId,q));
  stmts.push(db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,'Sales Return',?,?,?,0,'Cash',0)")
   .bind('CB-BORD-'+crypto.randomUUID(),today(),returnId,'Original ordinary FIFO refund for '+invoiceId,refund));
  stmts.push(db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'BUNDLE_ORDINARY_CASH_RETURN','SALE_RETURN',?,?)")
   .bind(user.userId,returnId,'Cash refund of original ordinary item '+productId+' on '+invoiceId));
  try{await db.batch(stmts);}catch{
   const saved=await db.prepare('SELECT return_id,invoice_id,product_id,quantity,payload_sha256 FROM bundle_ordinary_return_requests WHERE request_id=?')
    .bind(requestId).first<Previous>();
   if(saved)return replay(saved);
   return fail('Ordinary cash refund failed or physical source changed; all writes rolled back.',409);
  }
  return Response.json({ok:true,replayed:false,returnId,invoiceId,productId,quantityReturned:qty,refundAmount:refund,costMinor});
 }catch(e){return fail(e instanceof Error?e.message:'Ordinary FIFO return cannot be safely reconciled.',409);}
}
