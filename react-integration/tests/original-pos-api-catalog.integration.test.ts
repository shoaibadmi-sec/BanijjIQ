import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOriginalPosCatalog} from '../overlay/src/integration/originalPosCatalog';

const row=(overrides:Record<string,unknown>={})=>({
  productId:'D1-P100',productName:'Real Copper Cable',brand:'Brand A',
  category:'Electrical',unit:'Pcs',barcode:'C-100',sellingPrice:140,
  purchasePrice:100,minimumStock:5,currentStock:36,status:'Active',
  trackSerial:false,trackExpiry:false,trackWarranty:false,updatedAt:'2026-10-30T00:00:00Z',
  ...overrides
});
const response=(products:unknown[])=>({ok:true,products,categories:[],brands:[],units:[]});

test('original POS maps authenticated D1 catalog into existing HisabIQ Product without demo fallback',async()=>{
  let reads=0;
  const products=await loadOriginalPosCatalog(async()=>{
    reads++;
    return response([row(),row({productId:'D1-P200',productName:'Real Motor',currentStock:0,barcode:'M-200'})]) as never;
  });
  assert.equal(reads,1);
  assert.deepEqual(products.map(p=>p.id),['D1-P100','D1-P200']);
  assert.equal(products[0].name,'Real Copper Cable');
  assert.equal(products[0].stock,36);
  assert.equal(products[0].sellPrice,140);
  assert.equal(products[1].stock,0);
  assert.equal(products.some(p=>p.id==='p1'),false,'must never fall back to a demo seed');
});

test('invalid/unsupported backend products fail closed instead of substituting a demo catalog',async()=>{
  await assert.rejects(()=>loadOriginalPosCatalog(async()=>response([row({productType:'Bundle'})]) as never),/Unsupported product type/);
  await assert.rejects(()=>loadOriginalPosCatalog(async()=>response([row({currentStock:'unknown'})]) as never),/Invalid D1 product/);
  await assert.rejects(()=>loadOriginalPosCatalog(async()=>{throw new Error('D1 offline');}),/D1 offline/);
});
