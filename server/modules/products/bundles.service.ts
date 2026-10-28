import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';

type ComponentRequest = { productId?: string; quantityPerSet?: number };
type BundleRequest = {
  productName?: string; brand?: string; category?: string; barcode?: string;
  sellingPrice?: number; expectedRevision?: number; components?: ComponentRequest[];
};
type ComponentRow = { productId:string; name:string; quantityPerSet:number; unit:string; currentStock:number };
const str = (v:unknown) => String(v??'').trim();
const fail = (message:string,status=400) => Response.json({ok:false,error:message},{status});

async function checkedRecipe(db:SherDatabase, bundleId:string, input:BundleRequest): Promise<ComponentRow[]> {
  if(!Array.isArray(input.components)||input.components.length<1||input.components.length>30)
    throw Error('A bundle requires 1–30 distinct Standard components.');
  const seen=new Set<string>(), out:ComponentRow[]=[];
  for(const c of input.components) {
    const id=str(c.productId),qty=Number(c.quantityPerSet);
    if(!id||seen.has(id)||id===bundleId) throw Error('Bundle components must be distinct physical products; nested bundles are not allowed.');
    if(!Number.isSafeInteger(qty)||qty<1||qty>100000) throw Error('Component quantity must be 1–100,000 whole base units.');
    const row=await db.prepare(`SELECT product_id,product_name,unit,current_stock,status,is_deleted,product_type,track_serial,track_expiry
      FROM products WHERE product_id=?`).bind(id).first<any>();
    if(!row||row.is_deleted||row.status!=='Active'||row.product_type!=='Standard') throw Error(`Component ${id} must be an active Standard product.`);
    if(row.track_serial||row.track_expiry) throw Error(`Component ${row.product_name} has serial/expiry tracking. Bundle sales of tracked components need a dedicated allocation flow.`);
    seen.add(id);
    out.push({productId:id,name:row.product_name,quantityPerSet:qty,unit:row.unit,currentStock:Number(row.current_stock||0)});
  }
  return out;
}

function validateMaster(input:BundleRequest): string|undefined {
  if(!str(input.productName)||str(input.productName).length>180) return 'Enter a bundle name (up to 180 characters).';
  if(!str(input.category)) return 'Choose a bundle category.';
  const price=Number(input.sellingPrice);
  if(!Number.isFinite(price)||price<0||price>1e12) return 'Enter a valid independent selling price.';
  if(str(input.barcode).length>150) return 'Barcode is too long.';
}

async function checkUnique(db:SherDatabase,input:BundleRequest,except='') {
  const existing=await db.prepare(`SELECT product_id FROM products WHERE is_deleted=0 AND
    (LOWER(product_name)=LOWER(?) OR (?<>'' AND barcode=?)) AND product_id<>? LIMIT 1`)
    .bind(str(input.productName),str(input.barcode),str(input.barcode),except).first();
  return !existing;
}

export async function createBundle(db:SherDatabase,input:BundleRequest,user:AuthUser):Promise<Response>{
  const message=validateMaster(input);if(message)return fail(message);
  if(!await checkUnique(db,input))return fail('Product name or barcode already exists.',409);
  const id='BND-'+crypto.randomUUID().slice(0,12).toUpperCase();
  let components:ComponentRow[];
  try{components=await checkedRecipe(db,id,input)}catch(e){return fail(e instanceof Error?e.message:'Invalid recipe.');}
  const statements:SqlPreparedStatement[]=[
    db.prepare(`INSERT INTO products
      (product_id,product_name,brand,category,unit,barcode,purchase_price,selling_price,
       current_stock,minimum_stock,status,product_type,bundle_revision)
      VALUES (?,?,?,?,'Set',?,0,?,0,0,'Active','Bundle',1)`)
      .bind(id,str(input.productName),str(input.brand),str(input.category),str(input.barcode),Number(input.sellingPrice)),
    ...components.map(c=>db.prepare(`INSERT INTO bundle_components
      (bundle_id,revision,component_id,quantity_per_set,unit_snapshot) VALUES (?,?,?,?,?)`)
      .bind(id,1,c.productId,c.quantityPerSet,c.unit)),
    db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'CREATE_BUNDLE','BUNDLE',?,?)`)
      .bind(user.userId,id,`1 revision; ${components.length} components`)
  ];
  await db.batch(statements);
  return Response.json({ok:true,productId:id,revision:1});
}

async function readRecipe(db:SherDatabase,id:string,revision:number):Promise<ComponentRow[]>{
  const rows=await db.prepare(`SELECT bc.component_id AS productId,p.product_name AS name,bc.quantity_per_set AS quantityPerSet,
    bc.unit_snapshot AS unit,p.current_stock AS currentStock
    FROM bundle_components bc JOIN products p ON p.product_id=bc.component_id
    WHERE bc.bundle_id=? AND bc.revision=? ORDER BY bc.id`).bind(id,revision).all<ComponentRow>();
  return rows.results||[];
}

function available(components:ComponentRow[]):number{
  if(!components.length)return 0;
  return Math.max(0,Math.min(...components.map(c=>Math.floor(Math.max(0,Number(c.currentStock||0))/Number(c.quantityPerSet)))));
}

export async function getBundle(db:SherDatabase,id:string):Promise<Response>{
  const bundle=await db.prepare(`SELECT product_id AS productId,product_name AS productName,brand,category,barcode,
    selling_price AS sellingPrice,status,bundle_revision AS revision FROM products
    WHERE product_id=? AND product_type='Bundle' AND is_deleted=0`).bind(id).first<any>();
  if(!bundle)return fail('Bundle not found.',404);
  const components=await readRecipe(db,id,Number(bundle.revision));
  return Response.json({ok:true,bundle:{...bundle,components,availableSets:available(components),stockUnit:'Set'}});
}

export async function listBundles(db:SherDatabase):Promise<Response>{
  const rows=await db.prepare(`SELECT product_id AS productId FROM products WHERE product_type='Bundle' AND is_deleted=0
    ORDER BY created_at DESC, id DESC`).all<{productId:string}>();
  const items=[];
  for(const row of rows.results||[]){
    const r=await getBundle(db,row.productId);
    if(r.ok)items.push((await r.json() as any).bundle);
  }
  return Response.json({ok:true,bundles:items});
}

export async function updateBundle(db:SherDatabase,id:string,input:BundleRequest,user:AuthUser):Promise<Response>{
  const master=await db.prepare(`SELECT product_id,bundle_revision,status FROM products WHERE product_id=?
    AND product_type='Bundle' AND is_deleted=0`).bind(id).first<any>();
  if(!master)return fail('Bundle not found.',404);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==master.bundle_revision)return fail('Bundle was changed by another user. Reload its latest revision.',409);
  const message=validateMaster(input);if(message)return fail(message);
  if(!await checkUnique(db,input,id))return fail('Product name or barcode already exists.',409);
  let components:ComponentRow[];
  try{components=await checkedRecipe(db,id,input)}catch(e){return fail(e instanceof Error?e.message:'Invalid recipe.');}
  const old=await readRecipe(db,id,master.bundle_revision);
  const changed=JSON.stringify(old.map(x=>[x.productId,x.quantityPerSet]))!==JSON.stringify(components.map(x=>[x.productId,x.quantityPerSet]));
  const hasSales=!!await db.prepare('SELECT 1 FROM sale_items WHERE product_id=? LIMIT 1').bind(id).first();
  const rev=changed&&hasSales?Number(master.bundle_revision)+1:Number(master.bundle_revision);
  const statements:SqlPreparedStatement[]=[
    db.prepare(`UPDATE products SET product_name=?,brand=?,category=?,barcode=?,selling_price=?,
      bundle_revision=?,updated_at=datetime('now') WHERE product_id=? AND bundle_revision=?`)
      .bind(str(input.productName),str(input.brand),str(input.category),str(input.barcode),Number(input.sellingPrice),rev,id,input.expectedRevision)
  ];
  if(changed){
    if(!hasSales)statements.push(db.prepare('DELETE FROM bundle_components WHERE bundle_id=? AND revision=?').bind(id,rev));
    statements.push(...components.map(c=>db.prepare(`INSERT INTO bundle_components
      (bundle_id,revision,component_id,quantity_per_set,unit_snapshot) VALUES (?,?,?,?,?)`)
      .bind(id,rev,c.productId,c.quantityPerSet,c.unit)));
    if(hasSales)statements.push(db.prepare('UPDATE bundle_components SET is_active=0 WHERE bundle_id=? AND revision=?').bind(id,master.bundle_revision));
  }
  statements.push(db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note)
    VALUES (?,'UPDATE_BUNDLE','BUNDLE',?,?)`).bind(user.userId,id,`Revision ${rev}; changed recipe ${changed}`));
  await db.batch(statements);
  return Response.json({ok:true,productId:id,revision:rev,recipeChanged:changed});
}

export async function deactivateBundle(db:SherDatabase,id:string,user:AuthUser):Promise<Response>{
  const row=await db.prepare(`SELECT product_id FROM products WHERE product_id=? AND product_type='Bundle'
    AND is_deleted=0`).bind(id).first();
  if(!row)return fail('Bundle not found.',404);
  await db.batch([
    db.prepare(`UPDATE products SET status='Inactive',updated_at=datetime('now') WHERE product_id=?`).bind(id),
    db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note)
      VALUES (?,'DEACTIVATE_BUNDLE','BUNDLE',?,'Bundle is excluded from sales')`).bind(user.userId,id)
  ]);
  return Response.json({ok:true});
}
