import test from 'node:test';
import assert from 'node:assert/strict';
import { BackendRequestError } from '../overlay/src/integration/banijjApi.ts';
import {
  MOHIM_PRODUCT_FIELDS, draftFromProduct, createPayload, editPayload, productActionPolicy
} from '../overlay/src/integration/products/productForm.ts';
import {
  adjustProductStock, changeProductStatus, loadProductHistory
} from '../overlay/src/integration/products/productApi.ts';

const product = {
  productId: 'PRD-1', productName: 'PVC Pipe', brand: 'ABC', category: 'Pipe', unit: 'Pcs',
  barcode: '123', purchasePrice: 5, sellingPrice: 10, currentStock: 15, minimumStock: 3,
  updatedAt: 'rev-01', status: 'Active', trackSerial:0, trackExpiry:0, trackWarranty:0
};

test('Mohim form fields follow compact, predictable entry order with real lookup names',()=>{
  assert.deepEqual(MOHIM_PRODUCT_FIELDS, [
    'productName', 'brand', 'category', 'unit', 'purchasePrice',
    'sellingPrice', 'currentStock', 'minimumStock', 'barcode'
  ]);
  const blank=draftFromProduct(null);
  assert.equal(blank.productName,'');
  assert.equal(blank.unit,'');
  assert.equal(blank.currentStock,'0');
  const edit=draftFromProduct(product);
  assert.equal(edit.productName,'PVC Pipe');
  assert.equal(edit.purchasePrice,'5');
  assert.equal(edit.currentStock,'15');
});

test('valid new single-unit product creates only supported API fields and permits zero stock/cost',()=>{
  const draft={...draftFromProduct(null), productName:'  Copper Cable  ',brand:'  ',
    category:'Electrical',unit:'Pcs',purchasePrice:'0',sellingPrice:'100',
    currentStock:'0',minimumStock:'0',barcode:''};
  const payload=createPayload(draft);
  assert.equal(payload.productName,'Copper Cable');
  assert.equal(payload.currentStock,0);
  assert.equal(payload.purchasePrice,0);
  assert.equal(payload.trackSerial,false);
  assert.equal(payload.trackExpiry,false);
});

test('validate required fields, no negative/NaN/unsafe/overprecision stock or price',()=>{
  const draft={...draftFromProduct(product)};
  for(const key of ['productName','category','unit']){
    assert.throws(()=>createPayload({...draft,[key]:''}), /required/i);
  }
  for(const [key,value] of [['purchasePrice','-1'],['sellingPrice','NaN'],['currentStock','1.00001'],['minimumStock','1e80'],['sellingPrice','']]){
    assert.throws(()=>createPayload({...draft,[key]:value}), /valid|decimal|nonnegative|required|safe/i, key);
  }
});

test('editing uses immutable product revision and cannot overwrite base unit or stock',()=>{
  const draft={...draftFromProduct(product), productName:'PVC Pipe B',purchasePrice:'0'};
  const edit=editPayload(product,draft);
  assert.equal(edit.expectedUpdatedAt,'rev-01');
  assert.equal(edit.productName,'PVC Pipe B');
  assert.equal(edit.purchasePrice,0);
  assert.equal('currentStock' in edit,false);
  assert.equal('unit' in edit,false);
  assert.throws(()=>editPayload(product,{...draft,currentStock:'14'}), /stock.*adjust/i);
  assert.throws(()=>editPayload(product,{...draft,unit:'Box'}), /unit.*cannot|unit.*locked/i);
  assert.throws(()=>editPayload({...product,updatedAt:''},draft), /revision/i);
});

test('action permissions distinguish supported and deferred operations without fake writes',()=>{
  const allowed=productActionPolicy(product,true);
  assert.equal(allowed.view,true);
  assert.equal(allowed.edit,true);
  assert.equal(allowed.adjustStock,true);
  assert.equal(allowed.lots,true);
  assert.equal(allowed.history,true);
  assert.equal(allowed.toggleStatus,true);
  for(const key of ['delete','offers','addLot','bundle']){
    assert.equal(allowed[key].enabled,false);
    assert.ok(allowed[key].reason);
  }
  const readonly=productActionPolicy(product,false);
  assert.equal(readonly.edit,false);
  assert.equal(readonly.adjustStock,false);
  assert.equal(readonly.toggleStatus,false);
  assert.equal(readonly.view,true);
  assert.equal(readonly.lots,true);
});

test('stock action API uses one authenticated POST and explicit reason; history and status use canonical endpoints', async()=>{
  const oldFetch=globalThis.fetch, oldStorage=globalThis.localStorage;
  const seen=[];
  try {
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
      getItem:()=> 'test-token',removeItem:()=>{}
    }});
    globalThis.fetch=async (url,opts)=>{
      seen.push({url,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null});
      const data=seen.length===2?{ok:true,items:[{movementId:'MOV-1',date:'2026-10-29',type:'STOCK_IN_ADJUSTMENT',quantityIn:2,quantityOut:0,balanceAfter:17,note:'Counted',lotId:'LOT-1'}]}:{ok:true};
      return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    };
    await adjustProductStock('PRD-1',2,'Counted');
    const history=await loadProductHistory('PRD-1');
    await changeProductStatus('PRD-1','Inactive');
    assert.deepEqual(seen.map(x=>[x.method,x.url]),[
      ['POST','/api/products/PRD-1/adjust-stock'],
      ['GET','/api/products/PRD-1/history'],
      ['PUT','/api/products/PRD-1/status']
    ]);
    assert.deepEqual(seen[0].body,{delta:2,note:'Counted'});
    assert.equal(history[0].movementId,'MOV-1');
    assert.deepEqual(seen[2].body,{status:'Inactive'});
    await assert.rejects(adjustProductStock('PRD-1',0,'Counted'),/non-zero/i);
    await assert.rejects(adjustProductStock('PRD-1',2,''),/reason/i);
    assert.equal(seen.length,3,'invalid adjustments must not send POST');
  } finally {
    globalThis.fetch=oldFetch;
    if(oldStorage===undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
  }
});

test('permission/conflict errors remain distinct and are never counted as successful saves',()=>{
  const forbidden=new BackendRequestError('Not allowed',403);
  const conflict=new BackendRequestError('Changed since opening',409);
  assert.equal(forbidden.status,403);
  assert.equal(conflict.status,409);
});
