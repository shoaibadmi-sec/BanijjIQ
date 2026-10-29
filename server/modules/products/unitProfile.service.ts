import type { SherDatabase } from '../../db/types.js';
import { buildUnitProfile, type UnitProfile } from './unitProfile.js';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' }
});
const error = (message:string,status=400)=>json({ok:false,error:message},status);

type SavedProfile = { base_unit:string; profile_json:string; revision:number; updated_at:string };

export async function readUnitProfile(db:SherDatabase, productId:string):Promise<Response> {
  const product=await db.prepare('SELECT product_id FROM products WHERE product_id=? AND is_deleted=0')
    .bind(productId).first();
  if(!product)return error('Product not found.',404);
  const row=await db.prepare('SELECT base_unit,profile_json,revision,updated_at FROM product_unit_profiles WHERE product_id=?')
    .bind(productId).first<SavedProfile>();
  return json({ok:true,productId,revision:row?.revision??0,
    profile:row?JSON.parse(row.profile_json) as UnitProfile:null,
    postingEnabled:true});
}

export async function saveUnitProfile(db:SherDatabase, productId:string, body:unknown):Promise<Response> {
  const product=await db.prepare('SELECT product_id,unit,selling_price FROM products WHERE product_id=? AND is_deleted=0')
    .bind(productId).first<{product_id:string;unit:string;selling_price:number}>();
  if(!product)return error('Product not found.',404);
  if(!body||typeof body!=='object')return error('Expected unit profile input.');
  const input=body as Record<string,unknown>;
  const revision=input.expectedRevision;
  if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)return error('Expected unit-profile revision is required.',409);
  let profile:UnitProfile;
  try{profile=buildUnitProfile(input,product.unit,Number(product.selling_price));}
  catch(e){return error(e instanceof Error?e.message:'Invalid unit profile.');}

  const saved=await db.prepare('SELECT revision FROM product_unit_profiles WHERE product_id=?')
    .bind(productId).first<{revision:number}>();
  if(Number(saved?.revision??0)!==revision)return error('Unit profile changed. Refresh and try again.',409);
  if(saved){
    const result=await db.prepare("UPDATE product_unit_profiles SET base_unit=?,profile_json=?,revision=revision+1,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE product_id=? AND revision=?")
      .bind(profile.baseUnit,JSON.stringify(profile),productId,Number(revision)).run();
    if(Number(result.meta.changes)!==1)return error('Unit profile changed concurrently. Refresh before saving.',409);
    return json({ok:true,productId,revision:Number(revision)+1,profile,postingEnabled:true});
  }
  try{
    await db.prepare("INSERT INTO product_unit_profiles (product_id,base_unit,profile_json,revision) VALUES (?,?,?,1)")
      .bind(productId,profile.baseUnit,JSON.stringify(profile)).run();
  }catch(e){
    if(/UNIQUE|constraint|PRIMARY KEY/i.test(String(e)))return error('Unit profile was created concurrently. Refresh before editing.',409);
    throw e;
  }
  return json({ok:true,productId,revision:1,profile,postingEnabled:true});
}

export async function saveGlobalUnitSymbol(db:SherDatabase,id:string,body:unknown):Promise<Response>{
  const symbol=body&&typeof body==='object'?(body as Record<string,unknown>).symbol:null;
  if(typeof symbol!=='string'||!/^[\p{L}\p{N}]{1,8}$/u.test(symbol.trim()))
    return error('Unit symbol must contain 1–8 letters or numbers.');
  const actual=symbol.trim();
  const existing=await db.prepare('SELECT unit_id FROM product_units WHERE unit_id=?')
    .bind(id).first();
  if(!existing)return error('Unit not found.',404);
  const duplicate=await db.prepare('SELECT unit_id FROM product_units WHERE LOWER(symbol)=LOWER(?) AND unit_id<>? AND status=? LIMIT 1')
    .bind(actual,id,'Active').first();
  if(duplicate)return error('Another active unit uses this short symbol.');
  await db.prepare('UPDATE product_units SET symbol=? WHERE unit_id=?').bind(actual,id).run();
  return json({ok:true,id,symbol:actual});
}
