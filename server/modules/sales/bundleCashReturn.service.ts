import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';

type Input={clientRequestId?:unknown;reason?:unknown;[key:string]:unknown};
type Invoice={invoice_id:string;customer_id:string;customer_name:string;customer_phone:string;
 grand_total:number;paid_amount:number;due_amount:number;discount:number;payment_type:string;
 payment_method:string;status:string;is_deleted:number};
type Line={product_id:string;product_name:string;quantity:number;unit_price:number;line_total:number};
type Recipe={bundle_id:string;revision:number;component_id:string;quantity_per_set:number;
 sets_sold:number;component_quantity:number};
type Source={id:number;visible_product_id:string;component_id:string;lot_id:string;
 quantity:number;unit_cost:number;cost_minor:number};
type Lot={lot_id:string;product_id:string;original_quantity:number;remaining_quantity:number;
 unit_cost:number;source_type:string};
type Product={product_id:string;current_stock:number;is_deleted:number};
type Previous={request_id:string;invoice_id:string;return_id:string;payload_sha256:string};
const fail=(message:string,status=400)=>Response.json({ok:false,error:message},{status});
const day=()=>new Date().toISOString().slice(0,10);
function whole(n:unknown):number{
 if(typeof n!=='number'||!Number.isSafeInteger(n)||n<=0||n>1e7)throw Error('Invalid original whole quantity.');
 return n;
}
function ticks(n:unknown):number{
 if(typeof n!=='number'||!Number.isFinite(n))throw Error('Invalid physical FIFO precision.');
 const x=n*10000,r=Math.round(x);
 if(!Number.isSafeInteger(r)||Math.abs(x-r)>0.000001)throw Error('Physical FIFO quantity/cost exceeds four decimal places.');
 return r;
}
const money=(n:number):number=>{
 if(!Number.isFinite(n)||Math.abs(n*100-Math.round(n*100))>0.000001||
    !Number.isSafeInteger(Math.round(n*100))||n<0)throw Error('Invalid original sale currency amount.');
 return Math.round(n*100);
};
async function hash(payload:unknown){
 const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
 return [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const mapKey=(...parts:string[])=>JSON.stringify(parts);
type Draw=Source&{balanceAfter:number};

/** Cash-only full-invoice compensation of exact original physical component FIFO sources. */
export async function returnFullBundleCashInvoice(db:SherDatabase,invoiceId:string,input:Input,user:AuthUser):Promise<Response>{
 const requestId=input?.clientRequestId,reason=input?.reason;
 if(typeof invoiceId!=='string'||invoiceId.length<1||typeof requestId!=='string'||
    !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)||
    typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500||
    !input||Object.keys(input).some(key=>!['clientRequestId','reason'].includes(key)))
  return fail('Full bundle refund needs a unique request key, 8–500 character reason and no quantity/price override.');
 const digest=await hash({invoiceId,requestId,reason:reason.trim()});
 const previous=await db.prepare('SELECT request_id,invoice_id,return_id,payload_sha256 FROM bundle_cash_return_requests WHERE request_id=?')
  .bind(requestId).first<Previous>();
 const replay=async(row:Previous)=>{
  if(row.invoice_id!==invoiceId||row.payload_sha256!==digest)return fail('Return request key was reused for different details.',409);
  const saved=await db.prepare('SELECT return_id,total_return_amount FROM sales_returns WHERE return_id=? AND invoice_id=?')
   .bind(row.return_id,row.invoice_id).first<{return_id:string;total_return_amount:number}>();
  return saved?Response.json({ok:true,replayed:true,returnId:row.return_id,invoiceId,refundAmount:saved.total_return_amount}):
   fail('Return request cannot be reconciled to a saved refund.',409);
 };
 if(previous)return replay(previous);
 const existing=await db.prepare('SELECT return_id FROM bundle_cash_return_requests WHERE invoice_id=?').bind(invoiceId).first();
 if(existing)return fail('This bundle invoice was already fully returned.',409);
 const session=await db.prepare("SELECT session_id FROM cash_sessions WHERE status='Open' LIMIT 1").first();
 if(!session)return fail('Start a cash session to refund this bundle invoice.');
 const sale=await db.prepare('SELECT invoice_id,customer_id,customer_name,customer_phone,grand_total,paid_amount,due_amount,discount,payment_type,payment_method,status,is_deleted FROM sales WHERE invoice_id=?')
  .bind(invoiceId).first<Invoice>();
 if(!sale)return fail('Original invoice not found.',404);
 if(sale.is_deleted||sale.status!=='Completed'||sale.payment_type!=='Cash'||sale.payment_method!=='Cash'||
    sale.due_amount!==0||sale.discount!==0||money(sale.grand_total)!==money(sale.paid_amount))
  return fail('Only unchanged, completely paid, cash-only bundle invoices can use this full refund.',409);
 if(await db.prepare('SELECT 1 AS x FROM sales_returns WHERE invoice_id=? LIMIT 1').bind(invoiceId).first())
  return fail('Existing sale returns require the audited partial-return workflow.',409);
 const [lineRows,recipeRows,sourceRows,sourceLots,cashRows]=await Promise.all([
  db.prepare('SELECT product_id,product_name,quantity,unit_price,line_total FROM sale_items WHERE invoice_id=? ORDER BY id').bind(invoiceId).all<Line>(),
  db.prepare('SELECT bundle_id,revision,component_id,quantity_per_set,sets_sold,component_quantity FROM sale_bundle_components WHERE invoice_id=? ORDER BY id').bind(invoiceId).all<Recipe>(),
  db.prepare('SELECT id,visible_product_id,component_id,lot_id,quantity,unit_cost,cost_minor FROM bundle_sale_allocations WHERE invoice_id=? ORDER BY id').bind(invoiceId).all<Source>(),
  db.prepare('SELECT product_id,lot_id,quantity,unit_cost FROM sale_item_lots WHERE invoice_id=?').bind(invoiceId).all<{product_id:string;lot_id:string;quantity:number;unit_cost:number}>(),
  db.prepare("SELECT debit,credit FROM cash_book WHERE type='Sale' AND reference=? AND is_deleted=0").bind(invoiceId).all<{debit:number;credit:number}>()
 ]);
 const lines=lineRows.results??[],recipes=recipeRows.results??[],sources=sourceRows.results??[];
 if(!lines.length||!recipes.length||!sources.length||cashRows.results?.length!==1||
   money(Number(cashRows.results[0]?.credit??NaN))!==money(sale.paid_amount)||
   money(Number(cashRows.results[0]?.debit??NaN))!==0)
  return fail('Original bundle invoice, cash receipt or source FIFO history is incomplete.',409);
 const visible=new Map<string,Line>(),components=new Map<string,number>();
 let subtotal=0;
 try{
  for(const line of lines){
   if(visible.has(line.product_id)||money(line.line_total)!==whole(line.quantity)*money(line.unit_price))
    throw Error('Original visible sale item totals are inconsistent.');
   visible.set(line.product_id,line);subtotal+=money(line.line_total);
  }
  if(subtotal!==money(sale.grand_total))throw Error('Original invoice sale totals do not reconcile.');
  for(const recipe of recipes){
   const line=visible.get(recipe.bundle_id),key=mapKey(recipe.bundle_id,recipe.component_id);
   if(!line||components.has(key)||whole(recipe.revision)<1||whole(recipe.quantity_per_set)*whole(recipe.sets_sold)!==whole(recipe.component_quantity)||
      recipe.sets_sold!==line.quantity)throw Error('Sold bundle recipe version and quantity are inconsistent.');
   components.set(key,recipe.component_quantity);
  }
  const sold=new Map<string,{qty:number;unitCost:number}>();
  for(const row of sourceLots.results??[]){
   const key=mapKey(row.product_id,row.lot_id),prior=sold.get(key);
   if(prior&&ticks(prior.unitCost)!==ticks(row.unit_cost))throw Error('Mixed original lot costs.');
   sold.set(key,{qty:(prior?.qty??0)+row.quantity,unitCost:row.unit_cost});
  }
  const sourced=new Map<string,number>(),totalByComponent=new Map<string,number>();
  for(const row of sources){
   const parent=visible.get(row.visible_product_id),bundle=recipes.some(r=>r.bundle_id===row.visible_product_id);
   if(!parent||(!bundle&&row.visible_product_id!==row.component_id)||!whole(row.quantity)||
      ticks(row.unit_cost)<=0||money(row.quantity*row.unit_cost)!==row.cost_minor)
     throw Error('Original physical source or acquisition cost is invalid.');
   const k=mapKey(row.visible_product_id,row.lot_id),prior=sourced.get(k)??0;
   sourced.set(k,prior+row.quantity);
   const componentKey=mapKey(row.visible_product_id,row.component_id);
   totalByComponent.set(componentKey,(totalByComponent.get(componentKey)??0)+row.quantity);
   if(bundle&&!components.has(componentKey))throw Error('Original bundle source was not in saved recipe.');
  }
  for(const [k,q] of sourced)if(!sold.has(k)||sold.get(k)!.qty!==q)
   throw Error('Physical FIFO allocation differs from original sold lot ledger.');
  for(const [k,q] of components)if(totalByComponent.get(k)!==q)
   throw Error('Original component demand differs from saved bundle recipe.');
  for(const [product,line] of visible)if(!recipes.some(r=>r.bundle_id===product)&&
     totalByComponent.get(mapKey(product,product))!==line.quantity)
   throw Error('Ordinary cart line lacks original source allocation.');
 }catch(e){return fail(e instanceof Error?e.message:'Invalid original bundle source history.',409);}
 const physicalIds=[...new Set(sources.map(x=>x.component_id))];
 const current=new Map<string,{product:Product;lotById:Map<string,Lot>;masterBefore:number;qty:number}>();
 try{
  for(const pid of physicalIds){
   const p=await db.prepare('SELECT product_id,current_stock,is_deleted FROM products WHERE product_id=?').bind(pid).first<Product>();
   const r=await db.prepare('SELECT lot_id,product_id,original_quantity,remaining_quantity,unit_cost,source_type FROM stock_lots WHERE product_id=? ORDER BY id').bind(pid).all<Lot>();
   if(!p||p.is_deleted)throw Error('Physical product was deleted after invoice.');
   let physical=0;
   const lotById=new Map<string,Lot>();
   for(const lot of r.results??[]){
    const rem=ticks(lot.remaining_quantity),orig=ticks(lot.original_quantity),cost=ticks(lot.unit_cost);
    if(rem<0||orig<0||rem>orig||cost<0||lot.source_type==='OVERSOLD')
      throw Error('Physical source lot balance cannot be certified.');
    physical+=rem;lotById.set(lot.lot_id,lot);
   }
   if(physical!==ticks(p.current_stock))throw Error('Product stock master differs from physical source lot totals.');
   const selected=sources.filter(s=>s.component_id===pid),restored=new Map<string,number>();
   let qty=0;
   for(const a of selected){
    const lot=lotById.get(a.lot_id),added=(restored.get(a.lot_id)??0)+ticks(a.quantity);
    if(!lot||ticks(lot.unit_cost)!==ticks(a.unit_cost)||ticks(lot.remaining_quantity)+added>ticks(lot.original_quantity))
      throw Error('Returning original FIFO source exceeds lot capacity or historical acquisition cost.');
    restored.set(a.lot_id,added);qty+=ticks(a.quantity);
   }
   if(!Number.isSafeInteger(physical+qty))throw Error('Returned physical quantity overflow.');
   current.set(pid,{product:p,lotById,masterBefore:physical,qty});
  }
 }catch(e){return fail(e instanceof Error?e.message:'Unsafe original FIFO restoration.',409);}
 const returnId='SRT-BUNDLE-'+crypto.randomUUID(),refundable=money(sale.grand_total);
 const batch:SqlPreparedStatement[]=[
  db.prepare('INSERT INTO bundle_cash_return_requests(request_id,invoice_id,return_id,payload_sha256) VALUES (?,?,?,?)')
   .bind(requestId,invoiceId,returnId,digest),
  db.prepare("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,customer_phone,refund_method,total_return_amount,reason,processed_by) VALUES (?,?,?,?,?,?,'Cash',?,?,?)")
   .bind(returnId,day(),invoiceId,sale.customer_id,sale.customer_name,sale.customer_phone,refundable/100,reason.trim(),user.fullName)
 ];
 for(const line of lines)batch.push(db.prepare(
  'INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) VALUES (?,?,?,?,?,?,?)')
  .bind(returnId,invoiceId,line.product_id,line.product_name,line.quantity,line.unit_price,line.line_total));
 for(const [pid,p] of current){
  const expected=p.masterBefore/10000,next=(p.masterBefore+p.qty)/10000;
  batch.push(db.prepare("UPDATE products SET current_stock=CASE WHEN current_stock=? AND is_deleted=0 AND ABS(COALESCE((SELECT SUM(remaining_quantity) FROM stock_lots WHERE product_id=? AND source_type<>'OVERSOLD'),0)-?)<0.00000001 THEN ? ELSE json_extract('BUNDLE_RETURN_STOCK_CONFLICT','$') END,updated_at=datetime('now') WHERE product_id=?")
   .bind(expected,pid,expected,next,pid));
  for(const lot of p.lotById.values()){
   const take=sources.filter(x=>x.component_id===pid&&x.lot_id===lot.lot_id).reduce((n,x)=>n+x.quantity,0);
   if(take===0)continue;
   const nextLot=lot.remaining_quantity+take;
   batch.push(db.prepare(
    "UPDATE stock_lots SET remaining_quantity=CASE WHEN remaining_quantity=? AND original_quantity>=? THEN ? ELSE json_extract('BUNDLE_RETURN_LOT_CONFLICT','$') END,updated_at=datetime('now'),status=CASE WHEN ?>0 THEN 'Active' ELSE 'Depleted' END WHERE lot_id=? AND product_id=?")
    .bind(lot.remaining_quantity,nextLot,nextLot,nextLot,lot.lot_id,pid));
  }
 }
 const restoredRunning=new Map<string,number>(),soldByVisibleLot=new Map<string,number>();
 for(const row of sources){
  const p=current.get(row.component_id)!;
  const old=restoredRunning.get(row.component_id)??p.masterBefore;
  const next=old+ticks(row.quantity);restoredRunning.set(row.component_id,next);
  const movementId='SM-BUNDLE-RETURN-'+crypto.randomUUID();
  batch.push(db.prepare(
   "INSERT INTO stock_movements(movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id) VALUES (?,?,'Sales Return',?,0,?,?,?)")
   .bind(movementId,row.component_id,row.quantity,next/10000,'BUNDLE RETURN:'+invoiceId+':'+row.visible_product_id,row.lot_id));
  batch.push(db.prepare(
   'INSERT INTO bundle_return_allocations(return_id,invoice_id,visible_product_id,component_id,lot_id,source_allocation_id,movement_id,quantity,unit_cost,cost_minor) VALUES (?,?,?,?,?,?,?,?,?,?)')
   .bind(returnId,invoiceId,row.visible_product_id,row.component_id,row.lot_id,row.id,movementId,row.quantity,row.unit_cost,row.cost_minor));
  const k=mapKey(row.visible_product_id,row.lot_id);
  soldByVisibleLot.set(k,(soldByVisibleLot.get(k)??0)+row.quantity);
 }
 for(const [key,q] of soldByVisibleLot){
  const [visible,lot]=JSON.parse(key) as [string,string];
  batch.push(db.prepare('INSERT INTO sales_return_item_lots(return_id,invoice_id,product_id,lot_id,quantity) VALUES (?,?,?,?,?)')
   .bind(returnId,invoiceId,visible,lot,q));
 }
 batch.push(db.prepare("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) VALUES (?,?,'Sales Return',?,?,?,0,'Cash',0)")
  .bind('CB-BUNDLE-RETURN-'+crypto.randomUUID(),day(),returnId,'Full cash refund for '+invoiceId,refundable/100));
 batch.push(db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'BUNDLE_CASH_RETURN','SALE_RETURN',?,?)")
  .bind(user.userId,returnId,'Full cash refund of '+invoiceId+' restoring original FIFO source lots'));
 try{await db.batch(batch);}catch{
  const prior=await db.prepare('SELECT request_id,invoice_id,return_id,payload_sha256 FROM bundle_cash_return_requests WHERE request_id=?')
   .bind(requestId).first<Previous>();
  if(prior)return replay(prior);
  return fail('Refund or original FIFO changed. No partial cash or inventory return was committed.',409);
 }
 const costMinor=sources.reduce((sum,row)=>sum+row.cost_minor,0);
 return Response.json({ok:true,replayed:false,invoiceId,returnId,refundAmount:refundable/100,costMinor});
}
