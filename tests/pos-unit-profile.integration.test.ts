import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';
import {buildUnitProfile,quoteUnitQuantities} from '../server/modules/products/unitProfile.ts';

test('two/three/four unit conversion matches one-line HisabIQ quantities and per-unit prices',()=>{
  const three=buildUnitProfile({units:[
    {unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2100},
    {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
    {unit:'Pcs',symbol:'PCS',sellingPrice:10}
  ]},'Pcs',10);
  assert.deepEqual(three.units.map(x=>x.factor),[240,20,1]);
  const quote=quoteUnitQuantities(three,{Carton:1,Box:2,Pcs:3});
  assert.equal(quote.baseQuantity,283);
  assert.equal(quote.lineTotal,2490);
  assert.equal(quote.description,'1 CT 2 BOX 3 PCS');
  assert.deepEqual(quote.entries.map(x=>x.quantity),[1,2,3]);
  const four=buildUnitProfile({units:[
    {unit:'Pallet',symbol:'PL',containsNext:10},
    {unit:'Carton',symbol:'CT',containsNext:12},
    {unit:'Box',symbol:'BOX',containsNext:20},
    {unit:'Pcs',symbol:'PCS'}
  ]},'Pcs',2);
  assert.deepEqual(four.units.map(x=>x.factor),[2400,240,20,1]);
  assert.equal(quoteUnitQuantities(four,{Pallet:1,Box:3,Pcs:5}).baseQuantity,2465);
  const gauge=buildUnitProfile({units:[
    {unit:'Gauge',symbol:'Gg',containsNext:16},
    {unit:'Gira',symbol:'Gr'}
  ]},'Gira',5);
  assert.equal(quoteUnitQuantities(gauge,{Gauge:2,Gira:3}).baseQuantity,35);
});

test('invalid chains, aliases, fractional quantities and overflow fail closed',()=>{
  const chain=(ratio:unknown)=>({units:[
    {unit:'Box',symbol:'BOX',containsNext:ratio},{unit:'Pcs',symbol:'PCS'}
  ]});
  for(const bad of [0,1,1.2,-1,Infinity,1000001])
    assert.throws(()=>buildUnitProfile(chain(bad),'Pcs',10));
  assert.throws(()=>buildUnitProfile({units:[
    {unit:'Box',symbol:'BOX',containsNext:20},{unit:'Box',symbol:'PCS'}]},'Pcs',10));
  assert.throws(()=>buildUnitProfile({units:[
    {unit:'Box',symbol:'BOX',containsNext:20},{unit:'Pcs',symbol:'BOX'}]},'Pcs',10));
  assert.throws(()=>buildUnitProfile(chain(20),'Feet',10));
  const profile=buildUnitProfile(chain(20),'Pcs',10);
  for(const q of [{Box:0,Pcs:0},{Box:-1},{Box:0.2},{Carton:1},{Box:NaN},{Box:Infinity}])
    assert.throws(()=>quoteUnitQuantities(profile,q as Record<string,number>));
});

test('authenticated D1 profile settings are revisioned and never change cash/stock/ledger',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let token='';
    async function api(method:string,path:string,body?:unknown){
      const headers:Record<string,string>={'content-type':'application/json'};
      if(token)headers.authorization='Bearer '+token;
      const response=await handleApiRequest(new Request('http://local.test'+path,{
        method,headers,body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as any};
    }
    const setup=await api('POST','/api/setup/admin',{
      fullName:'Unit Test',phone:'01000009111',password:'UnitTesting2026!'
    });
    assert.equal(setup.ok,true,JSON.stringify(setup));token=setup.token;
    const created=await api('POST','/api/products',{
      productName:'E2E unit profile cable',category:'Electrical',unit:'Pcs',
      barcode:'E2E-UNIT-01',purchasePrice:5,sellingPrice:10,currentStock:300,
      minimumStock:2,trackSerial:false,trackExpiry:false,trackWarranty:false,status:'Active'
    });
    assert.equal(created.ok,true,JSON.stringify(created));
    const id=created.productId;
    const before=db.native.prepare('SELECT current_stock FROM products WHERE product_id=?').get(id) as any;
    const moves=db.native.prepare('SELECT count(*) n FROM stock_movements WHERE product_id=?').get(id) as any;
    assert.equal((await api('GET','/api/products/'+id+'/unit-profile')).revision,0);
    const units=[
      {unit:'Carton',symbol:'CT',containsNext:12,sellingPrice:2100},
      {unit:'Box',symbol:'BOX',containsNext:20,sellingPrice:180},
      {unit:'Pcs',symbol:'PCS',sellingPrice:10}
    ];
    const createdProfile=await api('PUT','/api/products/'+id+'/unit-profile',{expectedRevision:0,units});
    assert.equal(createdProfile.ok,true,JSON.stringify(createdProfile));
    assert.equal(createdProfile.revision,1);
    assert.deepEqual(createdProfile.profile.units.map((x:any)=>x.factor),[240,20,1]);
    const stale=await api('PUT','/api/products/'+id+'/unit-profile',{expectedRevision:0,units});
    assert.equal(stale.status,409);
    const updated=await api('PUT','/api/products/'+id+'/unit-profile',{
      expectedRevision:1,units:units.map(x=>x.unit==='Box'?{...x,sellingPrice:190}:x)
    });
    assert.equal(updated.revision,2);
    const bad=await api('PUT','/api/products/'+id+'/unit-profile',{
      expectedRevision:2,units:[{unit:'Box',symbol:'BOX',containsNext:0},{unit:'Pcs',symbol:'PCS'}]
    });
    assert.equal(bad.ok,false);
    assert.equal((await api('GET','/api/products/'+id+'/unit-profile')).revision,2);
    const pos=await api('GET','/api/pos/bootstrap');
    assert.equal(pos.ok,true,JSON.stringify(pos));
    const product=pos.products.find((x:any)=>x.id===id);
    assert.equal(product.unitProfilePreview.revision,2);
    assert.equal(product.unitProfilePreview.postingEnabled,false);
    const lookup=await api('GET','/api/units');
    const pcs=lookup.items.find((x:any)=>x.name==='Pcs');
    assert.ok(pcs?.id);
    assert.equal((await api('PUT','/api/units/'+pcs.id+'/symbol',{symbol:'PCS'})).symbol,'PCS');
    assert.equal((await api('GET','/api/units')).items.find((x:any)=>x.id===pcs.id).symbol,'PCS');
    assert.equal((await api('PUT','/api/units/'+pcs.id+'/symbol',{symbol:'P C S'})).ok,false);
    assert.equal((await api('POST','/api/pos/cash-session/start',{openingCash:0})).ok,true);
    const rejected=await api('POST','/api/pos/sales',{
      clientRequestId:'unit-posting-not-enabled-0001',customerName:'No posting',customerPhone:'01000009222',
      paymentType:'Cash',discount:0,items:[{productId:id,qty:283,unitPrice:10,
        unitQuantities:{Carton:1,Box:2,Pcs:3},unitProfileRevision:2}]
    });
    assert.equal(rejected.ok,false);assert.match(rejected.error,/mixed-unit/i);
    assert.equal((db.native.prepare('SELECT count(*) n FROM sales').get() as any).n,0);
    assert.equal((db.native.prepare('SELECT count(*) n FROM cash_book').get() as any).n,0);
    assert.equal((db.native.prepare('SELECT count(*) n FROM sale_item_lots').get() as any).n,0);
    assert.equal((db.native.prepare('SELECT current_stock FROM products WHERE product_id=?').get(id) as any).current_stock,before.current_stock);
    assert.equal((db.native.prepare('SELECT count(*) n FROM stock_movements WHERE product_id=?').get(id) as any).n,moves.n);
  }finally{db.close();}
});
