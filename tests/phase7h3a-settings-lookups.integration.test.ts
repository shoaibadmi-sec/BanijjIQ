import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

const path='/api/products/settings/lookups';

test('7H3A original Product settings catalogue is D1-backed, permission-checked, and read-only',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    const api=async(method:string,url:string,body?:unknown,token='')=>{
      const res=await handleApiRequest(new Request('http://local.test'+url,{
        method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:res.status,...await res.json() as Record<string,any>};
    };
    assert.equal((await api('GET',path)).status,401);
    const admin=await api('POST','/api/setup/admin',{fullName:'Lookup Admin',phone:'01000009301',password:'LocalTestOnly2026!'});
    assert.equal(admin.status,200,JSON.stringify(admin));
    const token=admin.token as string;
    db.native.prepare("INSERT INTO product_categories(category_id,category_name,status) VALUES ('C-H','Hardware','Active'),('C-OLD','Old','Inactive')").run();
    db.native.prepare("INSERT INTO product_brands(brand_id,brand_name,status) VALUES ('B-1','RFL','Active'),('B-2','Old Brand','Inactive')").run();
    db.native.prepare("INSERT INTO product_units(unit_id,unit_name,status,symbol) VALUES ('U-PCS','Pcs','Active','PCS'),('U-BOX','Box','Active','BOX')").run();
    db.native.prepare("INSERT INTO products(product_id,product_name,category,brand,unit,is_deleted,current_stock) VALUES ('P-1','Pipe','Hardware','RFL','Pcs',0,10),('P-2','Wire','hardware','RFL','Pcs',0,1),('P-3','Deleted','Hardware','RFL','Pcs',1,3)").run();
    db.native.prepare("INSERT INTO product_unit_profiles(product_id,base_unit,profile_json,revision) VALUES ('P-1','Pcs',?,1)")
      .run(JSON.stringify({baseUnit:'Pcs',units:[{unit:'Box',symbol:'BOX',factor:20,containsNext:20,sellingPrice:100},{unit:'Pcs',symbol:'PCS',factor:1,containsNext:null,sellingPrice:5}]}));
    const role=await api('POST','/api/roles',{name:'SettingsNoProducts',permissions:{reports:{view:true}}},token);
    assert.equal(role.status,200,JSON.stringify(role));
    const staff=await api('POST','/api/users',{name:'Denied',mobile:'01000009302',role:'SettingsNoProducts',password:'LocalTestOnly2026!'},token);
    assert.equal(staff.status,200,JSON.stringify(staff));
    const login=await api('POST','/api/auth/login',{phone:'01000009302',password:'LocalTestOnly2026!'});
    assert.equal(login.status,200,JSON.stringify(login));
    const before=(db.native.prepare('SELECT total_changes() n').get() as {n:number}).n;
    assert.equal((await api('GET',path,undefined,login.token)).status,403);
    const reply=await api('GET',path,undefined,token);
    assert.equal(reply.status,200,JSON.stringify(reply));
    assert.deepEqual(reply.categories.map((r:{id:string;name:string;active:boolean;usage:number})=>[r.id,r.name,r.active,r.usage]),
      [['C-H','Hardware',true,2],['C-OLD','Old',false,0]]);
    assert.deepEqual(reply.brands.map((r:{id:string;name:string;active:boolean;usage:number})=>[r.id,r.name,r.active,r.usage]),
      [['B-2','Old Brand',false,0],['B-1','RFL',true,2]]);
    assert.deepEqual(reply.units.map((r:{id:string;name:string;symbol:string;usage:number;kind:string})=>[r.id,r.name,r.symbol,r.usage,r.kind]),
      [['U-BOX','Box','BOX',1,'Compound-ready'],['U-PCS','Pcs','PCS',2,'Compound-ready']]);
    assert.equal(reply.categories.some((r:{name:string})=>r.name==='Plumbing'),false,'never seed demo categories');
    assert.equal((db.native.prepare('SELECT total_changes() n').get() as {n:number}).n,before,'read-only and denied lookup reads cannot write');
  }finally{db.close();}
});

test('7H3A corrupt multi-unit profiles fail closed rather than underreporting settings usage',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
   runMigrations(db.native,resolve('migrations'));
   const api=async(method:string,url:string,body?:unknown,token='')=>{
     const res=await handleApiRequest(new Request('http://local.test'+url,{
       method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
       body:body===undefined?undefined:JSON.stringify(body)
     }),db);
     return {status:res.status,...await res.json() as Record<string,any>};
   };
   const admin=await api('POST','/api/setup/admin',{fullName:'Settings Audit',phone:'01000009303',password:'LocalTestOnly2026!'});
   assert.equal(admin.status,200,JSON.stringify(admin));
   db.native.prepare("INSERT INTO product_units(unit_id,unit_name,status,symbol) VALUES ('U-A','Pcs','Active','PCS')").run();
   db.native.prepare("INSERT INTO products(product_id,product_name,category,brand,unit,is_deleted) VALUES ('P-BAD','Bad','Hardware','','Pcs',0)").run();
   db.native.prepare("INSERT INTO product_unit_profiles(product_id,base_unit,profile_json,revision) VALUES ('P-BAD','Pcs','not-json',1)").run();
   const reply=await api('GET',path,undefined,admin.token);
   assert.equal(reply.status,409);
   assert.equal(reply.units,undefined);
 }finally{db.close();}
});
