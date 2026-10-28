import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { PosSaleInput } from './types.js';

type Product = {
  product_id: string; product_name: string; brand: string; unit: string;
  selling_price: number; purchase_price: number; current_stock: number;
  product_type: string; bundle_revision: number; track_serial:number; track_expiry:number; track_warranty:number;
};
type Physical = { lineId: string; product: Product; quantity:number; sourceBundle?:string; price:number; name:string; breakdown?: unknown };
type Draw = { lotId:string; take:number; cost:number; supplierId:string; remainingBefore:number; remainingAfter:number };
type Posting = { input:Physical; draws:Draw[]; negativeQty:number; stockBefore:number;stockAfter:number; mode:string };
const str=(v:unknown)=>String(v??'').trim();
const cents=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const fail=(message:string,status=400)=>Response.json({ok:false,error:message},{status});
const uid=(p:string)=>p+crypto.randomUUID().slice(0,12).toUpperCase();

async function currentProduct(db:SherDatabase,id:string):Promise<Product | null> {
  return db.prepare(`SELECT product_id,product_name,COALESCE(brand,'') AS brand,unit,
    selling_price,purchase_price,current_stock,product_type,bundle_revision,
    track_serial,track_expiry,track_warranty FROM products
    WHERE product_id=? AND is_deleted=0 AND status='Active'`).bind(id).first<Product>();
}
export async function hasBundleProducts(db:SherDatabase,items:{productId?:string}[]):Promise<boolean>{
  for(const x of items){const r=await db.prepare("SELECT product_type FROM products WHERE product_id=?").bind(str(x.productId)).first<{product_type:string}>();
    if(r?.product_type==='Bundle')return true;}
  return false;
}
type CheckoutLine={ product:Product; qty:number; price:number; breakdown?:unknown; recipe?:{component:Product;quantityPerSet:number;unit:string}[]; };
async function expand(db:SherDatabase,input:PosSaleInput):Promise<{lines:CheckoutLine[];physical:Physical[];subtotal:number}> {
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw Error('Enter 1–100 valid cart lines.');
  const ids=new Set<string>(), lines:CheckoutLine[]=[], physical:Physical[]=[];
  let subtotal=0;
  for(const [index,item] of input.items.entries()){
    const id=str(item.productId),q=Number(item.qty),price=Number(item.unitPrice);
    if(!id||ids.has(id))throw Error('Every product may appear only once per invoice.');
    if(!Number.isSafeInteger(q)||q<1||q>1000000)throw Error(`Line ${index+1}: enter a positive whole quantity.`);
    if(!Number.isFinite(price)||price<0||price>1e12)throw Error(`Line ${index+1}: enter a valid selling price.`);
    ids.add(id);
    const product=await currentProduct(db,id);
    if(!product)throw Error(`Line ${index+1}: product is not active or no longer exists.`);
    if(item.vendorId||item.fulfillmentMode==='vendor')throw Error('Vendor-sourced lines are not yet available in bundle checkouts.');
    if(product.track_serial||product.track_expiry||product.track_warranty)
      throw Error(`${product.product_name}: tracked/warranty items need the dedicated tracked POS workflow; cannot mix with bundles yet.`);
    if(product.product_type!=='Standard'&&product.product_type!=='Bundle')throw Error('Unsupported item type.');
    const line:CheckoutLine={product,qty:q,price,breakdown:item.unitBreakdown};
    if(product.product_type==='Bundle'){
      if(item.unitBreakdown?.length)throw Error('A bundle is sold as whole sets, not mixed units.');
      const componentRows=await db.prepare(`SELECT bc.component_id,bc.quantity_per_set,bc.unit_snapshot
        FROM bundle_components bc WHERE bc.bundle_id=? AND bc.revision=? AND bc.is_active=1 ORDER BY bc.id`)
        .bind(id,product.bundle_revision).all<any>();
      if(!componentRows.results?.length)throw Error(`${product.product_name} has no active recipe.`);
      line.recipe=[];
      for(const row of componentRows.results){
        const component=await currentProduct(db,String(row.component_id));
        if(!component||component.product_type!=='Standard'||component.track_serial||component.track_expiry||component.track_warranty)
          throw Error(`Bundle component ${row.component_id} is unavailable, virtual or tracked.`);
        const per=Number(row.quantity_per_set);
        if(!Number.isSafeInteger(per)||per<1||!Number.isSafeInteger(per*q)||per*q>1000000000)throw Error('Bundle quantity exceeds supported stock units.');
        line.recipe.push({component,quantityPerSet:per,unit:String(row.unit_snapshot)});
        physical.push({lineId:id,product:component,quantity:per*q,sourceBundle:id,price:0,name:component.product_name});
      }
    }else{
      // Mixed-unit quantities are always posted in canonical base units.
      if(item.unitBreakdown?.length){
        const relations=await db.prepare(`SELECT unit_name,base_factor FROM product_unit_conversions WHERE product_id=?`).bind(id).all<any>();
        const lookup=new Map<string,number>([[product.unit.toLowerCase(),1]]);
        for(const r of relations.results||[])lookup.set(String(r.unit_name).toLowerCase(),Number(r.base_factor));
        const seen=new Set<string>();let count=0;
        for(const part of item.unitBreakdown){
          const unit=String(part.unit||'').trim().toLowerCase(),n=Number(part.count);
          if(seen.has(unit)||!lookup.has(unit)||!Number.isSafeInteger(n)||n<0)throw Error('Invalid mixed-unit breakdown.');
          seen.add(unit);count+=n*lookup.get(unit)!;
        }
        if(count!==q)throw Error('Mixed-unit quantity does not match the posted base quantity.');
      }
      physical.push({lineId:id,product,quantity:q,price,name:product.product_name,breakdown:item.unitBreakdown});
    }
    subtotal=cents(subtotal+q*price);
    lines.push(line);
  }
  return {lines,physical,subtotal};
}
async function allocate(db:SherDatabase,demands:Physical[]):Promise<Posting[]> {
  const lotCache=new Map<string,{lotId:string;remaining:number;cost:number;supplierId:string}[]>();
  const stock=new Map<string,number>();
  const result:Posting[]=[];
  for(const item of demands){
    const pid=item.product.product_id;
    if(!stock.has(pid))stock.set(pid,Number(item.product.current_stock||0));
    let lots=lotCache.get(pid);
    if(!lots){
      const rows=await db.prepare(`SELECT lot_id,remaining_quantity,unit_cost,supplier_id
        FROM stock_lots WHERE product_id=? AND remaining_quantity>0 ORDER BY id`).bind(pid).all<any>();
      lots=(rows.results||[]).map(x=>({lotId:String(x.lot_id),remaining:Number(x.remaining_quantity),
        cost:Number(x.unit_cost||0),supplierId:String(x.supplier_id||'')}));
      lotCache.set(pid,lots);
    }
    let need=item.quantity;
    const draws:Draw[]=[];
    for(const lot of lots){
      if(need<=0)break;
      const take=Math.min(need,lot.remaining);
      if(take<=0)continue;
      const remainingBefore=lot.remaining;
      lot.remaining-=take;need-=take;
      draws.push({lotId:lot.lotId,take,cost:lot.cost,supplierId:lot.supplierId,remainingBefore,remainingAfter:lot.remaining});
    }
    // Bundles permit negative stock: create an oversold lot for any deficit.
    // Standard lines may opt into negative; normal in-stock standard sales remain unchanged.
    const negative=need;
    if(negative>0&&!item.sourceBundle)throw Error(`${item.product.product_name}: insufficient physical stock in this mixed checkout. Bundle components may go negative; standalone lines cannot.`);
    const stockBefore=stock.get(pid)??0,after=stockBefore-item.quantity;
    stock.set(pid,after);
    result.push({input:item,draws,negativeQty:negative,stockBefore,stockAfter:after,mode:item.sourceBundle?'Bundle':'Standard'});
  }
  return result;
}
export async function completeBundleSaleRoute(db:SherDatabase,input:PosSaleInput,user:AuthUser):Promise<Response>{
  const session=await db.prepare("SELECT session_id FROM cash_sessions WHERE status='Open' LIMIT 1").first();
  if(!session)return fail('Start the POS cash session before selling a bundle.');
  const name=str(input.customerName),phone=str(input.customerPhone),date=str(input.date)||new Date().toISOString().slice(0,10);
  if(!name||!phone)return fail('Customer name and phone are required.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>new Date().toISOString().slice(0,10))return fail('Invalid sale date.');
  if(date<new Date().toISOString().slice(0,10)&&!str(input.backdatedReason))return fail('Backdated sale reason is required.');
  let expanded:{lines:CheckoutLine[];physical:Physical[];subtotal:number},posted:Posting[];
  try{expanded=await expand(db,input);posted=await allocate(db,expanded.physical);}
  catch(e){return fail(e instanceof Error?e.message:'Unable to plan bundle sale.');}
  const discount=Number(input.discount||0);
  if(!Number.isFinite(discount)||discount<0||discount>expanded.subtotal)return fail('Discount exceeds sale subtotal.');
  const total=cents(expanded.subtotal-discount);
  let paid=0,due=0;
  if(input.paymentType==='Cash')paid=total;
  else if(input.paymentType==='Due')due=total;
  else if(input.paymentType==='Partial'){
    paid=Number(input.paidAmount);
    if(!Number.isFinite(paid)||paid<=0||paid>=total)return fail('Enter a valid partial payment.');
    paid=cents(paid);due=cents(total-paid);
  }else return fail('Choose Cash, Due or Partial.');
  const method=paid>0?(str(input.paymentMethod)||'Cash'):'';
  if(method&&!['Cash','Bank','Mobile Banking'].includes(method))return fail('Invalid payment method.');
  let bankId='',bankName='';
  if(method==='Bank'||method==='Mobile Banking'){
    bankId=str(input.bankAccountId);
    const b=await db.prepare(`SELECT account_name,account_type FROM bank_accounts
      WHERE bank_account_id=? AND status='Active'`).bind(bankId).first<any>();
    if(!b||str(b.account_type)!==method)return fail('Choose an active account matching your payment method.');
    bankName=b.account_name;
  }
  const customer=await db.prepare("SELECT customer_id,current_due FROM customers WHERE phone=? AND is_deleted=0").bind(phone).first<any>();
  const customerId=str(customer?.customer_id||input.customerId)||((due>0)?uid('CUS-'):'');
  const invoiceId=uid('INV-'),stmts:SqlPreparedStatement[]=[];
  if(due>0&&!customer)stmts.push(db.prepare(`INSERT INTO customers
    (customer_id,customer_name,phone,father_name,address,current_due,status,is_deleted)
    VALUES (?,?,?,?,?,0,'Active',0)`).bind(customerId,name,phone,str(input.customerFatherName),str(input.customerAddress)));
  const status=due>0?(paid>0?'Partial':'Due'):'Paid';
  stmts.push(db.prepare(`INSERT INTO sales
    (invoice_id,sale_date,sale_time,customer_id,customer_name,customer_phone,customer_address,customer_father_name,
    subtotal,discount,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method,
    bank_account_id,bank_account_name,is_backdated,backdated_reason,status,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Completed',?)`)
    .bind(invoiceId,date,new Date().toISOString().slice(11,19),customerId,name,phone,str(input.customerAddress),
      str(input.customerFatherName),expanded.subtotal,discount,total,paid,due,input.paymentType,status,method,bankId,bankName,
      date<new Date().toISOString().slice(0,10)?1:0,str(input.backdatedReason),user.fullName));
  for(const line of expanded.lines){
    const pid=line.product.product_id,display=(line.product.brand?line.product.brand+' ':'')+line.product.product_name;
    stmts.push(db.prepare(`INSERT INTO sale_items
      (invoice_id,product_id,product_name,quantity,unit_price,line_total,unit_breakdown_json,sold_product_type)
      VALUES (?,?,?,?,?,?,?,?)`).bind(invoiceId,pid,display,line.qty,line.price,cents(line.qty*line.price),
        JSON.stringify(line.breakdown||[]),line.recipe?'Bundle':'Standard'));
    if(line.recipe){
      for(const c of line.recipe)stmts.push(db.prepare(`INSERT INTO sale_bundle_components
        (invoice_id,bundle_id,revision,component_id,quantity_per_set,sets_sold,component_quantity,unit_snapshot)
        VALUES (?,?,?,?,?,?,?,?)`).bind(invoiceId,pid,line.product.bundle_revision,c.component.product_id,
        c.quantityPerSet,line.qty,c.quantityPerSet*line.qty,c.unit));
    }
  }
  for(const plan of posted){
    const p=plan.input.product,pid=p.product_id,parent=plan.input.lineId;
    // Sequential updates use the virtual allocation balances; no lot can be consumed twice.
    stmts.push(db.prepare(`UPDATE products SET current_stock=
      CASE WHEN current_stock=? THEN ? ELSE NULL END,updated_at=datetime('now') WHERE product_id=?`)
      .bind(plan.stockBefore,plan.stockAfter,pid));
    for(const draw of plan.draws){
      stmts.push(db.prepare(`UPDATE stock_lots SET remaining_quantity=
        CASE WHEN remaining_quantity=? THEN ? ELSE NULL END,updated_at=datetime('now'),
        status=CASE WHEN ?>0 THEN 'Active' ELSE 'Depleted' END WHERE lot_id=?`)
        .bind(draw.remainingBefore,draw.remainingAfter,draw.remainingAfter,draw.lotId));
      stmts.push(db.prepare(`INSERT INTO sale_item_lots
        (invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id,source_sale_product_id)
        VALUES (?,?,?,?,?,?,?)`)
        .bind(invoiceId,pid,draw.lotId,draw.take,draw.cost,draw.supplierId,parent));
      stmts.push(db.prepare(`INSERT INTO stock_movements
        (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id,source_sale_product_id)
        VALUES (?,?,'Sale',0,?,?,?,?,?)`)
        .bind(uid('SM-'),pid,draw.take,plan.stockAfter,invoiceId,draw.lotId,parent));
    }
    if(plan.negativeQty>0){
      const lotId=uid('LOT-');
      stmts.push(db.prepare(`INSERT INTO stock_lots
        (lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity,unit_cost,status)
        VALUES (?,?,'OVERSOLD',?,0,?,?,'Oversold')`)
        .bind(lotId,pid,invoiceId,-plan.negativeQty,Number(p.purchase_price||0)));
      stmts.push(db.prepare(`INSERT INTO sale_item_lots
        (invoice_id,product_id,lot_id,quantity,unit_cost,supplier_id,source_sale_product_id)
        VALUES (?,?,?,?,?,'',?)`)
        .bind(invoiceId,pid,lotId,plan.negativeQty,Number(p.purchase_price||0),parent));
      stmts.push(db.prepare(`INSERT INTO stock_movements
        (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,note,lot_id,source_sale_product_id)
        VALUES (?,?,'Sale',0,?,?,?,?,?)`)
        .bind(uid('SM-'),pid,plan.negativeQty,plan.stockAfter,invoiceId,lotId,parent));
    }
  }
  if(paid>0){
    if(bankId)stmts.push(db.prepare(`INSERT INTO bank_book (entry_id,bank_account_id,date,type,reference,description,debit,credit,is_deleted)
      VALUES (?,?,?,'Sale',?,?,0,?,0)`).bind(uid('BB-'),bankId,date,invoiceId,`POS sale to ${name}`,paid));
    else stmts.push(db.prepare(`INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted)
      VALUES (?,?, 'Sale',?,?,0,?,'Cash',0)`).bind(uid('CB-'),date,invoiceId,`POS sale to ${name}`,paid));
  }
  if(due>0){
    const next=cents(Number(customer?.current_due||0)+due);
    stmts.push(db.prepare("UPDATE customers SET current_due=?,updated_at=datetime('now') WHERE customer_id=?").bind(next,customerId));
    stmts.push(db.prepare(`INSERT INTO customer_ledger
      (ledger_id,date,customer_id,customer_name,type,reference,debit,credit,balance,notes)
      VALUES (?,?,?,?, 'Sale',?,?,0,?,'')`).bind(uid('CL-'),date,customerId,name,invoiceId,due,next));
  }
  stmts.push(db.prepare(`INSERT INTO audit_logs
    (user_id,action,entity_type,entity_id,note) VALUES (?,'CREATE_SALE','SALE',?,?)`)
    .bind(user.userId,invoiceId,`Bundle checkout; ${expanded.lines.length} sale lines; ${posted.length} physical demands; total ${total}`));
  await db.batch(stmts);
  return Response.json({ok:true,invoice:{invoiceId,date,customerName:name,customerPhone:phone,subtotal:expanded.subtotal,
    discount,grandTotal:total,paidAmount:paid,dueAmount:due,paymentStatus:status,paymentMethod:method,
    items:expanded.lines.map(l=>({productId:l.product.product_id,productName:l.product.product_name,quantity:l.qty,
      unit:l.recipe?'Set':l.product.unit,unitPrice:l.price,lineTotal:cents(l.qty*l.price),
      soldProductType:l.recipe?'Bundle':'Standard'}))}});
}
