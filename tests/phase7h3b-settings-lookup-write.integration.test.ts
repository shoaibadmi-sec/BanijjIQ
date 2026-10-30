import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('7H3B original Product settings controls create real Bangla names and unit symbols, toggle status and safely delete',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  const api=async(method:string,path:string,body?:unknown,token='')=>{
   const res=await handleApiRequest(new Request('http://local.test'+path,{
    method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:res.status,...await res.json() as Record<string,any>};
  };
  const admin=await api('POST','/api/setup/admin',{fullName:'Lookup Admin',phone:'01000009401',password:'LocalTestOnly2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));
  const token=admin.token as string,path='/api/products/settings/lookups';
  assert.equal((await api('POST',path,{kind:'category',name:'Hardware',nameBn:'হার্ডওয়্যার'})).status,401);
  const cat=await api('POST',path,{kind:'category',name:'Hardware',nameBn:'হার্ডওয়্যার'},token);
  assert.equal(cat.status,200,JSON.stringify(cat));assert.equal(cat.item.nameBn,'হার্ডওয়্যার');
  const brand=await api('POST',path,{kind:'brand',name:'RFL',nameBn:'আরএফএল'},token);
  assert.equal(brand.status,200,JSON.stringify(brand));assert.equal(brand.item.nameBn,'আরএফএল');
  const unit=await api('POST',path,{kind:'unit',name:'Pieces',symbol:'PCS'},token);
  assert.equal(unit.status,200,JSON.stringify(unit));assert.equal(unit.item.symbol,'PCS');
  assert.equal((await api('POST',path,{kind:'unit',name:'Box',symbol:'pcs'},token)).status,409);
  assert.equal((await api('POST',path,{kind:'category',name:' hardware '},token)).status,409);
  assert.equal((await api('POST',path,{kind:'unit',name:'Feet',symbol:'bad symbol'},token)).status,400);
  assert.equal((await api('POST',path,{kind:'brand',name:'RFL',nameBn:'overwrite'},token)).status,409);
  const list=await api('GET',path,undefined,token);
  assert.equal(list.status,200,JSON.stringify(list));
  assert.equal(list.categories.find((r:{id:string})=>r.id===cat.item.id)?.nameBn,'হার্ডওয়্যার');
  assert.equal(list.brands.find((r:{id:string})=>r.id===brand.item.id)?.nameBn,'আরএফএল');
  const url=`${path}/category/${encodeURIComponent(cat.item.id)}`;
  assert.equal((await api('PUT',url+'/status',{status:'Inactive'},token)).status,200);
  const inactive=await api('GET',path,undefined,token);
  assert.equal(inactive.categories.find((r:{id:string})=>r.id===cat.item.id).active,false);
  assert.equal((await api('PUT',url+'/status',{status:'invalid'},token)).status,400);
  const restored=await api('PUT',url+'/status',{status:'Active'},token);
  assert.equal(restored.status,200);
  const deleted=await api('DELETE',url,undefined,token);assert.equal(deleted.status,200,JSON.stringify(deleted));
  assert.equal((await api('GET',path,undefined,token)).categories.some((r:{id:string})=>r.id===cat.item.id),false);
 }finally{db.close();}
});

test('7H3B block deletion when active, deleted, or multi-unit records use a lookup; enforce delete RBAC',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  const api=async(method:string,path:string,body?:unknown,token='')=>{
   const res=await handleApiRequest(new Request('http://local.test'+path,{method,
    headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:body===undefined?undefined:JSON.stringify(body)}),db);
   return {status:res.status,...await res.json() as Record<string,any>};
  };
  const admin=await api('POST','/api/setup/admin',{fullName:'RBAC Audit',phone:'01000009403',password:'LocalTestOnly2026!'});
  assert.equal(admin.status,200,JSON.stringify(admin));const token=admin.token as string;
  const path='/api/products/settings/lookups';
  const cat=await api('POST',path,{kind:'category',name:'Electrical'},token);
  const brand=await api('POST',path,{kind:'brand',name:'Vision'},token);
  const pcs=await api('POST',path,{kind:'unit',name:'Pieces',symbol:'PCS'},token);
  const box=await api('POST',path,{kind:'unit',name:'Box',symbol:'BOX'},token);
  for(const result of [cat,brand,pcs,box])assert.equal(result.status,200,JSON.stringify(result));
  db.native.prepare("INSERT INTO products(product_id,product_name,category,brand,unit,is_deleted) VALUES ('LOOK-P1','Cable','Electrical','Vision','Pieces',1)").run();
  db.native.prepare("INSERT INTO product_unit_profiles(product_id,base_unit,profile_json,revision) VALUES ('LOOK-P1','Pieces',?,1)")
   .run(JSON.stringify({baseUnit:'Pieces',units:[{unit:'Box',symbol:'BOX',factor:20,containsNext:20,sellingPrice:100},{unit:'Pieces',symbol:'PCS',factor:1,containsNext:null,sellingPrice:5}]}));
  for(const [kind,id] of [['category',cat.item.id],['brand',brand.item.id],['unit',pcs.item.id],['unit',box.item.id]]){
   const response=await api('DELETE',`${path}/${kind}/${id}`,undefined,token);
   assert.equal(response.status,409,`${kind} ${id} is still referenced, including deleted products`);
  }
  const role=await api('POST','/api/roles',{name:'LookupEditorOnly',permissions:{products:{view:true,add:true,edit:true}}},token);
  assert.equal(role.status,200,JSON.stringify(role));
  const staff=await api('POST','/api/users',{name:'Lookup Editor',mobile:'01000009404',role:'LookupEditorOnly',password:'LocalTestOnly2026!'},token);
  assert.equal(staff.status,200,JSON.stringify(staff));
  const login=await api('POST','/api/auth/login',{phone:'01000009404',password:'LocalTestOnly2026!'});
  assert.equal(login.status,200,JSON.stringify(login));
  const allowed=await api('POST',path,{kind:'category',name:'Unused'},login.token);
  assert.equal(allowed.status,200,JSON.stringify(allowed));
  assert.equal((await api('DELETE',`${path}/category/${allowed.item.id}`,undefined,login.token)).status,403);
  assert.equal((await api('PUT',`${path}/category/${cat.item.id}/status`,{status:'Inactive'},login.token)).status,200);
  const after=await api('GET',path,undefined,token);
  assert.ok(after.categories.some((r:{id:string})=>r.id===allowed.item.id));
 }finally{db.close();}
});
