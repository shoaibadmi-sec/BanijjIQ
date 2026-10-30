import type {SherDatabase} from '../../db/types.js';

export type LookupKind='category'|'brand'|'unit';
type Schema={table:string;id:string;name:string;bangla?:string;prefix:string;productField:string};
const schemas:Record<LookupKind,Schema>={
 category:{table:'product_categories',id:'category_id',name:'category_name',bangla:'category_name_bn',prefix:'PCAT',productField:'category'},
 brand:{table:'product_brands',id:'brand_id',name:'brand_name',bangla:'brand_name_bn',prefix:'PBRD',productField:'brand'},
 unit:{table:'product_units',id:'unit_id',name:'unit_name',prefix:'PUNT',productField:'unit'}
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8'}
});
const failure=(error:string,status=400)=>json({ok:false,error},status);
export function lookupKind(value:unknown):LookupKind|null{
 return value==='category'||value==='brand'||value==='unit'?value:null;
}
function readRecord(body:unknown):Record<string,unknown>{
 return body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
}
function label(value:unknown,max:number,required:boolean):string|null{
 if(value===undefined||value===null){return required?null:'';}
 if(typeof value!=='string')return null;
 const clean=value.trim();
 return (required&&!clean)||clean.length>max?null:clean;
}

/**
 * One atomic INSERT ... SELECT per lookup. Duplicate names (case-insensitive),
 * inactive historical names and active unit symbols cannot be silently reused.
 */
export async function createSettingsLookup(db:SherDatabase,body:unknown):Promise<Response>{
 const row=readRecord(body),kind=lookupKind(row.kind);
 if(!kind)return failure('Select a valid product lookup kind.');
 const name=label(row.name,96,true);
 const nameBn=label(row.nameBn,128,false);
 if(name===null||nameBn===null)return failure('Enter a valid name and optional Bangla name.');
 const s=schemas[kind],id=s.prefix+'-'+crypto.randomUUID();
 let statement:string,args:string[];
 if(kind==='unit'){
  const symbol=label(row.symbol,8,true);
  if(symbol===null||!/^[\p{L}\p{N}]{1,8}$/u.test(symbol))
   return failure('Unit symbol must be 1–8 letters or numbers.');
  statement=`INSERT INTO product_units (unit_id,unit_name,symbol,status)
   SELECT ?,?,?,'Active' WHERE NOT EXISTS
    (SELECT 1 FROM product_units WHERE lower(trim(unit_name))=lower(trim(?)))
   AND NOT EXISTS
    (SELECT 1 FROM product_units WHERE status='Active' AND lower(trim(symbol))=lower(trim(?)))`;
  args=[id,name,symbol,name,symbol];
 }else{
  statement=`INSERT INTO ${s.table} (${s.id},${s.name},${s.bangla},status)
   SELECT ?,?,?,'Active' WHERE NOT EXISTS
    (SELECT 1 FROM ${s.table} WHERE lower(trim(${s.name}))=lower(trim(?)))`;
  args=[id,name,nameBn,name];
 }
 try {
  const result=await db.prepare(statement).bind(...args).run();
  if(Number(result.meta.changes)!==1)return failure('The lookup name or active symbol already exists.',409);
 }catch(e){
  if(/unique|constraint/i.test(String(e)))return failure('The lookup name or active symbol already exists.',409);
  throw e;
 }
 return json({ok:true,item:{id,name,...(kind==='unit'?{symbol:args[2]}:{nameBn}),active:true,usage:0}});
}

/** Never convert arbitrary statuses to Active, and reject symbol collisions on unit reactivation. */
export async function setSettingsLookupStatus(db:SherDatabase,kind:LookupKind,id:string,body:unknown):Promise<Response>{
 const row=readRecord(body),status=row.status;
 if(status!=='Active'&&status!=='Inactive')return failure('Status must be Active or Inactive.');
 const s=schemas[kind];
 const existing=await db.prepare(`SELECT ${s.id} id FROM ${s.table} WHERE ${s.id}=?`)
   .bind(id).first<{id:string}>();
 if(!existing)return failure('Lookup not found.',404);
 let sql=`UPDATE ${s.table} SET status=? WHERE ${s.id}=?`;
 if(kind==='unit'&&status==='Active')
  sql+=` AND NOT EXISTS (SELECT 1 FROM product_units other
    WHERE other.unit_id<>product_units.unit_id AND other.status='Active'
    AND trim(other.symbol)<>'' AND lower(trim(other.symbol))=lower(trim(product_units.symbol)))`;
 const updated=await db.prepare(sql).bind(status,id).run();
 if(Number(updated.meta.changes)!==1)return failure('Another active unit already uses this symbol.',409);
 return json({ok:true,id,active:status==='Active'});
}

/**
 * Atomic conditional delete. Even soft-deleted products retain historical lookup
 * references; unit chains in saved profiles are also immutable source data.
 */
export async function deleteSettingsLookup(db:SherDatabase,kind:LookupKind,id:string):Promise<Response>{
 const s=schemas[kind];
 const current=await db.prepare(`SELECT ${s.id} id FROM ${s.table} WHERE ${s.id}=?`)
  .bind(id).first<{id:string}>();
 if(!current)return failure('Lookup not found.',404);
 let sql=`DELETE FROM ${s.table} WHERE ${s.id}=?
   AND NOT EXISTS (SELECT 1 FROM products p
     WHERE lower(trim(p.${s.productField}))=lower(trim(${s.table}.${s.name})))`;
 if(kind==='unit'){
  sql+=` AND NOT EXISTS (SELECT 1 FROM product_unit_profiles up WHERE
    NOT json_valid(up.profile_json) OR
    lower(trim(up.base_unit))=lower(trim(product_units.unit_name))
    OR EXISTS (SELECT 1 FROM json_each(
     CASE WHEN json_valid(up.profile_json) THEN up.profile_json ELSE '{"units":[]}' END,
     '$.units') je WHERE lower(trim(json_extract(je.value,'$.unit')))=
     lower(trim(product_units.unit_name))))`;
 }
 try {
  const deleted=await db.prepare(sql).bind(id).run();
  if(Number(deleted.meta.changes)!==1)
   return failure('This lookup is used by products or saved unit profiles and cannot be deleted.',409);
 }catch(e){
  if(kind==='unit')return failure('Unit profile could not be reconciled; deletion is blocked.',409);
  throw e;
 }
 return json({ok:true,id});
}
