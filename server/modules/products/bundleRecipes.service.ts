import type {SherDatabase} from '../../db/types.js';
type ComponentInput={productId?:unknown;quantityPerSet?:unknown};
type RecipeInput={bundleId?:unknown;name?:unknown;sellingPrice?:unknown;components?:unknown};
type Physical={product_id:string;unit:string;product_type:string;track_serial:number;track_expiry:number;track_warranty:number;status:string;is_deleted:number};
const fail=(message:string,status=400)=>Response.json({ok:false,error:message},{status});

/** Guarded creation of a version-one virtual recipe. No edit or POS exposure before full lifecycle. */
export async function createBundleRecipe(db:SherDatabase,input:RecipeInput):Promise<Response>{
 const id=input?.bundleId,name=input?.name,price=input?.sellingPrice;
 const components=input?.components;
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)||
    typeof name!=='string'||name.trim().length<1||name.trim().length>180||
    typeof price!=='number'||!Number.isFinite(price)||price<0||
    !Number.isSafeInteger(Math.round(price*100))||Math.abs(price*100-Math.round(price*100))>0.000001||
    !Array.isArray(components)||components.length<1||components.length>30)
  return fail('Valid bundle ID/name, two-decimal selling price and 1–30 components are required.');
 const rows:{id:string;count:number;unit:string}[]=[];
 const seen=new Set<string>();
 for(const line of components as ComponentInput[]){
  const cid=line?.productId,count=line?.quantityPerSet;
  if(typeof cid!=='string'||!cid||cid===id||seen.has(cid)||typeof count!=='number'||!Number.isSafeInteger(count)||count<1||count>100000)
    return fail('Bundle recipe needs distinct Standard products and positive whole per-set quantities.');
  seen.add(cid);
  const p=await db.prepare('SELECT product_id,unit,product_type,track_serial,track_expiry,track_warranty,status,is_deleted FROM products WHERE product_id=?')
   .bind(cid).first<Physical>();
  if(!p||p.status==='Inactive'||p.is_deleted||p.product_type!=='Standard')return fail('Component must be an active physical Standard product: '+cid,409);
  if(p.track_serial||p.track_expiry||p.track_warranty)return fail('Tracked/warranty components need a dedicated bundle allocation workflow: '+cid,409);
  rows.push({id:cid,count,unit:p.unit});
 }
 const stmts=[
  db.prepare("INSERT INTO products (product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status,product_type,bundle_revision) VALUES (?,?,'Bundles','Set',0,?,0,'Active','Bundle',1)")
   .bind(id,name.trim(),price)
 ];
 for(const r of rows)stmts.push(db.prepare('INSERT INTO bundle_components(bundle_id,revision,component_id,quantity_per_set,unit_snapshot) VALUES (?,1,?,?,?)')
  .bind(id,r.id,r.count,r.unit));
 try{await db.batch(stmts);}
 catch{return fail('Bundle ID already exists or recipe could not be saved.',409);}
 return Response.json({ok:true,bundleId:id,revision:1,components:rows.length});
}
