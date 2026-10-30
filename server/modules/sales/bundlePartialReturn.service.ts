import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';
import {hasModulePermission} from '../auth/permissions.js';

type Input={clientRequestId?:unknown;reason?:unknown;setsToReturn?:unknown;[key:string]:unknown};
type Sale={invoice_id:string;grand_total:number;paid_amount:number;due_amount:number;payment_type:string;
 payment_method:string;discount:number;status:string;is_deleted:number;customer_id:string;
 customer_name:string;customer_phone:string};
type Line={product_id:string;product_name:string;quantity:number;unit_price:number;line_total:number;product_type:string};
type Recipe={bundle_id:string;component_id:string;revision:number;quantity_per_set:number;sets_sold:number;component_quantity:number};
type Source={id:number;visible_product_id:string;component_id:string;lot_id:string;quantity:number;unit_cost:number;cost_minor:number};
type Lot={lot_id:string;original_quantity:number;remaining_quantity:number;unit_cost:number;source_type:string};
type Prev={invoice_id:string;return_id:string;payload_sha256:string};
type Draw={source:Source;take:number;costMinor:number};
const fail=(error:string,status=400)=>Response.json({ok:false,error},{status});
const today=()=>new Date().toISOString().slice(0,10);
const cents=(value:unknown):number=>{
 const v=Number(value),n=Math.round(v*100);
 if(!Number.isFinite(v)||!Number.isSafeInteger(n)||Math.abs(v*100-n)>0.000001||v<0)
  throw new Error('Invoice amount is not a valid poisha amount.');
 return n;
};
const whole=(value:unknown):number=>{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||value>1000000)
  throw new Error('Quantity must be a positive whole number of complete sets.');
 return value;
};
async function fingerprint(input:unknown){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

/** Repeated cash returns of whole sets, one bundle SKU per invoice. No legacy return flow is touched. */
export async function returnPartialBundleSets(db:SherDatabase,invoiceId:string,input:Input,user:AuthUser):Promise<Response>{
 if(!(await hasModulePermission(db,user,'returns','add')))
  return fail('Sales Returns permission is required.',403);
 const key=input?.clientRequestId,reason=input?.reason,sets=input?.setsToReturn;
 if(!invoiceId||typeof key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(key)||
    typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500||
    !input||Object.keys(input).some(k=>!['clientRequestId','reason','setsToReturn'].includes(k))||
    typeof sets!=='number'||!Number.isSafeInteger(sets)||sets<1||sets>1000000)
  return fail('Enter a whole number of complete bundle sets, one unique request key and an 8–500 character reason.');
 const digest=await fingerprint({invoiceId,key,reason:reason.trim(),sets});
 const replay=async(row:Prev)=>{
  if(row.invoice_id!==invoiceId||row.payload_sha256!==digest)return fail('Request key was already used for different return details.',409);
  const saved=await db.prepare('SELECT return_id,total_return_amount FROM sales_returns WHERE return_id=? AND invoice_id=?')
   .bind(row.return_id,invoiceId).first<{return_id:string;total_return_amount:number}>();
  return saved?Response.json({ok:true,replayed:true,invoiceId,returnId:row.return_id,refundAmount:saved.total_return_amount}):
   fail('Saved return could not be reconciled.',409);
 };
 const prior=await db.prepare('SELECT invoice_id,return_id,payload_sha256 FROM bundle_partial_return_requests WHERE request_id=?')
   .bind(key).first<Prev>();
 if(prior)return replay(prior);
 if(!(await db.prepare("SELECT session_id FROM cash_sessions WHERE status='Open' LIMIT 1").first()))
  return fail('Start the POS cash session before refunding a bundle.');
 const sale=await db.prepare('SELECT invoice_id,grand_total,paid_amount,due_amount,payment_type,payment_method,discount,status,is_deleted,customer_id,customer_name,customer_phone FROM sales WHERE invoice_id=?')
  .bind(invoiceId).first<Sale>();
 if(!sale)return fail('Original sale invoice not found.',404);
 let grand:number,unitPrice:number;
 try{
  grand=cents(sale.grand_total);
  if(sale.status!=='Completed'||sale.is_deleted||sale.payment_type!=='Cash'||sale.payment_method!=='Cash'||
     Number(sale.due_amount)!==0||Number(sale.discount)!==0||cents(sale.paid_amount)!==grand)
    throw Error('Only unchanged cash-only bundle invoices are eligible.');
 }catch(e){return fail(e instanceof Error?e.message:'Invalid sale money.',409);}
 const [lineRows,recipeRows,sourcesRows,previousRows,cashRows,existingFull,existingReturns]=await Promise.all([
  db.prepare('SELECT i.product_id,i.product_name,i.quantity,i.unit_price,i.line_total,p.product_type FROM sale_items i JOIN products p ON p.product_id=i.product_id WHERE i.invoice_id=?').bind(invoiceId).all<Line>(),
  db.prepare('SELECT bundle_id,component_id,revision,quantity_per_set,sets_sold,component_quantity FROM sale_bundle_components WHERE invoice_id=? ORDER BY id').bind(invoiceId).all<Recipe>(),
  db.prepare('SELECT id,visible_product_id,component_id,lot_id,quantity,unit_cost,cost_minor FROM bundle_sale_allocations WHERE invoice_id=? ORDER BY id').bind(invoiceId).all<Source>(),
  db.prepare('SELECT r.bundle_id,r.sets_returned FROM bundle_partial_return_requests r WHERE r.invoice_id=?').bind(invoiceId)
   .all<{bundle_id:string;sets_returned:number}>(),
  db.prepare("SELECT debit,credit FROM cash_book WHERE type='Sale' AND reference=? AND is_deleted=0").bind(invoiceId).all<{debit:number;credit:number}>(),
  db.prepare('SELECT 1 AS x FROM bundle_cash_return_requests WHERE invoice_id=? LIMIT 1').bind(invoiceId).first(),
  db.prepare('SELECT return_id FROM sales_returns WHERE invoice_id=?').bind(invoiceId).all<{return_id:string}>()
 ]);
 const lines=lineRows.results??[],recipes=recipeRows.results??[],sources=sourcesRows.results??[],priorSets=previousRows.results??[];
 if(lines.length!==1||lines[0].product_type!=='Bundle'||recipes.length<1||sources.length<1||existingFull||
    cashRows.results?.length!==1||Number(cashRows.results[0].debit)!==0||
    cashRows.results[0].credit!==sale.paid_amount)
  return fail('Partial return requires a single-bundle-only original cash invoice and complete original FIFO history.',409);
 const line=lines[0];let soldSets:number,totalReturned:number;
 try{
  soldSets=whole(line.quantity);unitPrice=cents(line.unit_price);
  if(soldSets*unitPrice!==grand||cents(line.line_total)!==grand)throw Error('Original bundle cash sale amount is inconsistent.');
  totalReturned=priorSets.reduce((n,x)=>n+whole(x.sets_returned),0);
  if(priorSets.some(x=>x.bundle_id!==line.product_id)||
     existingReturns.results?.length!==priorSets.length)throw Error('Unrecognized return history for this bundle.');
  if(sets>soldSets-totalReturned)throw Error('Requested bundle sets exceed unreturned complete sets.');
  for(const recipe of recipes){
   if(recipe.bundle_id!==line.product_id||!Number.isSafeInteger(recipe.quantity_per_set)||
      recipe.quantity_per_set<1||recipe.revision<1||recipe.sets_sold!==soldSets||
      recipe.component_quantity!==soldSets*recipe.quantity_per_set)
    throw Error('Immutable bundle recipe quantity is inconsistent.');
  }
  const needs=new Map(recipes.map(x=>[x.component_id,sets*x.quantity_per_set]));
  const priorAlloc=(await db.prepare('SELECT x.source_allocation_id,SUM(x.quantity) qty FROM bundle_partial_return_allocations x JOIN bundle_partial_return_requests r ON r.return_id=x.return_id WHERE r.invoice_id=? GROUP BY x.source_allocation_id')
   .bind(invoiceId).all<{source_allocation_id:number;qty:number}>()).results??[];
  const returned=new Map(priorAlloc.map(x=>[x.source_allocation_id,x.qty]));
  const draws:Draw[]=[];
  for(const source of sources){
   if(source.visible_product_id!==line.product_id||!needs.has(source.component_id)||
      !Number.isSafeInteger(source.quantity)||source.quantity<1||
      source.unit_cost<=0||cents(source.unit_cost)!==source.unit_cost*100||
      cents(source.quantity*source.unit_cost)!==source.cost_minor)
    throw Error('Original physical component FIFO allocation cannot be certified for partial return.');
   const already=Number(returned.get(source.id)??0),remaining=source.quantity-already,need=needs.get(source.component_id)!;
   if(!Number.isSafeInteger(already)||already<0||remaining<0)throw Error('Previous component return exceeds source capacity.');
   const take=Math.min(Math.max(remaining,0),need);
   if(take>0){draws.push({source,take,costMinor:cents(take*source.unit_cost)});
    needs.set(source.component_id,need-take);}
  }
  if([...needs.values()].some(n=>n!==0))throw Error('Insufficient unreturned original FIFO component allocations.');
  const refundable=sets*unitPrice;
  if(!Number.isSafeInteger(refundable)||refundable>(soldSets-totalReturned)*unitPrice)
    throw Error('Requested cash refund exceeds original sale balance.');
  // Ensure cash-book returns match the recorded previous returns, never infer cash availability.
  const cashRefunds=(await db.prepare('SELECT SUM(cb.debit) paid FROM cash_book cb JOIN sales_returns r ON r.return_id=cb.reference WHERE r.invoice_id=? AND cb.type=\'Sales Return\' AND cb.is_deleted=0')
   .bind(invoiceId).first<{paid:number}>())?.paid??0;
  if(cents(cashRefunds)!==totalReturned*unitPrice)throw Error('Previously refunded bundle cash does not reconcile.');
  const physical=new Map<string,{masterBefore:number;restored:number;lots:Map<string,Lot>}>();
  for(const pid of needs.keys()){
   const p=await db.prepare('SELECT current_stock,is_deleted,product_type FROM products WHERE product_id=?').bind(pid)
    .first<{current_stock:number;is_deleted:number;product_type:string}>();
   if(!p||p.is_deleted||p.product_type!=='Standard')throw Error('Original physical bundle component is unavailable.');
   const row=await db.prepare('SELECT lot_id,original_quantity,remaining_quantity,unit_cost,source_type FROM stock_lots WHERE product_id=?').bind(pid).all<Lot>();
   const lots=new Map<string,Lot>(),stock=(row.results??[]).reduce((n,x)=>n+x.remaining_quantity,0);
   for(const lot of row.results??[]){
    if(!Number.isFinite(lot.remaining_quantity)||lot.remaining_quantity<0||
       lot.remaining_quantity>lot.original_quantity||lot.source_type==='OVERSOLD')throw Error('Unsafe physical stock lot balance.');
    lots.set(lot.lot_id,lot);
   }
   if(Math.abs(stock-p.current_stock)>0.00000001)throw Error('Physical source lots do not reconcile with product stock.');
   const restoration=draws.filter(x=>x.source.component_id===pid).reduce((n,x)=>n+x.take,0);
   for(const lot of lots.values()){
    const addition=draws.filter(x=>x.source.component_id===pid&&x.source.lot_id===lot.lot_id).reduce((n,x)=>n+x.take,0);
    if(lot.remaining_quantity+addition>lot.original_quantity)throw Error('Original FIFO lot restoration exceeds original quantity.');
   }
   physical.set(pid,{masterBefore:p.current_stock,restored:restoration,lots});
  }
  const returnId='SRT-BPART-'+crypto.randomUUID(),refund=refundable/100;
  const batches:SqlPreparedStatement[]=[
   db.prepare('INSERT INTO bundle_partial_return_requests(request_id,return_id,invoice_id,bundle_id,sets_returned,payload_sha256) VALUES (?,?,?,?,?,?)')
    .bind(key,returnId,invoiceId,line.product_id,sets,digest),
   db.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason,processed_by) VALUES (?,?,?,?,?,?,'Cash',?,?,?)")
    .bind(returnId,today(),invoiceId,sale.customer_id,sale.customer_name,sale.customer_phone,refund,reason.trim(),user.fullName),
   db.prepare('INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES (?,?,?,?,?,?,?)')
    .bind(returnId,invoiceId,line.product_id,line.product_name,sets,line.unit_price,refund)
  ];
  for(const [pid,p] of physical){
   batches.push(db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? AND is_deleted=0 AND ABS(COALESCE((SELECT SUM(remaining_quantity) FROM stock_lots WHERE product_id=? AND source_type<>'OVERSOLD'),0)-?)<0.00000001 THEN ? ELSE json_extract('BUNDLE_PARTIAL_STOCK_CONFLICT','$') END,updated_at=datetime('now') WHERE product_id=?")
    .bind(p.masterBefore,pid,p.masterBefore,p.masterBefore+p.restored,pid));
   for(const [lotId,lot] of p.lots){
    const take=draws.filter(x=>x.source.component_id===pid&&x.source.lot_id===lotId).reduce((n,x)=>n+x.take,0);
    if(take===0)continue;
    const next=lot.remaining_quantity+take;
    batches.push(db.prepare("UPDATE stock_lots SET remaining_quantity=CASE WHEN remaining_quantity=? AND original_quantity>=? THEN ? ELSE json_extract('BUNDLE_PARTIAL_FIFO_CONFLICT','$') END,updated_at=datetime('now'),status='Active' WHERE product_id=? AND lot_id=?")
     .bind(lot.remaining_quantity,next,next,pid,lotId));
   }
  }
  const running=new Map<string,number>(),lotReturned=new Map<string,number>();let totalCost=0;
  for(const d of draws){
   const pid=d.source.component_id,p=physical.get(pid)!;
   const next=(running.get(pid)??p.masterBefore)+d.take;running.set(pid,next);
   const movement='SM-BPART-'+crypto.randomUUID();
   batches.push(db.prepare("INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,'Sales Return',?,0,?,?,?)")
    .bind(movement,pid,d.take,next,'BUNDLE PART RETURN:'+invoiceId+':'+line.product_id,d.source.lot_id));
   batches.push(db.prepare('INSERT INTO bundle_partial_return_allocations(return_id,invoice_id,visible_product_id,component_id,lot_id,source_allocation_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(returnId,invoiceId,line.product_id,pid,d.source.lot_id,d.source.id,movement,d.take,d.source.unit_cost,d.costMinor));
   lotReturned.set(d.source.lot_id,(lotReturned.get(d.source.lot_id)??0)+d.take);
   totalCost+=d.costMinor;
  }
  for(const [lotId,qty] of lotReturned)batches.push(db.prepare('INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,?,?,?,?)')
   .bind(returnId,invoiceId,line.product_id,lotId,qty));
  batches.push(db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,'Sales Return',?,?,?,0,'Cash',0)")
   .bind('CB-BPART-'+crypto.randomUUID(),today(),returnId,'Partial complete-set cash refund for '+invoiceId,refund));
  batches.push(db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'BUNDLE_PARTIAL_RETURN','SALE_RETURN',?,?)")
   .bind(user.userId,returnId,'Returned '+sets+' complete sets for '+invoiceId+' with original FIFO source lots'));
  try{await db.batch(batches);}catch{
   const committed=await db.prepare('SELECT invoice_id,return_id,payload_sha256 FROM bundle_partial_return_requests WHERE request_id=?')
    .bind(key).first<Prev>();
   if(committed)return replay(committed);
   return fail('Bundle refund or physical FIFO changed. No partial cash or stock writes were committed.',409);
  }
  return Response.json({ok:true,replayed:false,invoiceId,returnId,setsReturned:sets,refundAmount:refund,costMinor:totalCost});
 }catch(e){return fail(e instanceof Error?e.message:'Partial bundle return could not be safely planned.',409);}
}
