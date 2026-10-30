import test from 'node:test';
import assert from 'node:assert/strict';
import {toSourceCartLine,toSourceProduct,patchLiveLineFromSource} from '../overlay/src/integration/sourcePosCartBridge.ts';
import {quoteLiveUnits} from '../overlay/src/integration/posUnitMath.ts';
import type {PosProduct} from '../overlay/src/integration/banijjApi.ts';

const product:PosProduct={id:'REAL-UNIT-PRODUCT',name:'PVC Pipe',productName:'PVC Pipe',brand:'X',category:'Pipe',unit:'Ft',barcode:'BAR1',sellingPrice:10,stock:410,minimumStock:8,trackSerial:false,trackExpiry:false,trackWarranty:false,unitProfilePreview:{revision:2,postingEnabled:true,baseUnit:'Ft',units:[{unit:'CT',symbol:'CT',factor:240,containsNext:12,sellingPrice:2250},{unit:'Box',symbol:'BOX',factor:20,containsNext:20,sellingPrice:195},{unit:'Ft',symbol:'Ft',factor:1,containsNext:null,sellingPrice:10}]}};
test('exact source CartTable receives real BanijjIQ catalog products and natural multi-unit chain',()=>{
 const p=toSourceProduct(product);assert.equal(p.id,product.id);assert.equal(p.stock,410);
 assert.deepEqual(p.unitRelations,[{leftUnit:'CT',rightUnit:'Box',quantity:12},{leftUnit:'Box',rightUnit:'Ft',quantity:20}]);
 assert.equal(p.unitSellPrices?.CT,2250);assert.equal(p.unitSellPrices?.Box,195);
 const original={product,qty:1,price:10,serialNumbers:[],source:{mode:'own' as const},unitQuantities:{Ft:1}};
 const line=toSourceCartLine(original);assert.equal(line.key,product.id);assert.equal(line.product.name,'PVC Pipe');assert.deepEqual(line.unitQuantities,{Ft:'1'});
});
test('source cart 3-unit input becomes the exact backend base-qty and price without demo stock or fabricated payment',()=>{
 const old={product,qty:1,price:10,serialNumbers:[],source:{mode:'own' as const},unitQuantities:{Ft:1}};
 const next=patchLiveLineFromSource(old,{unitQuantities:{CT:'1',Box:'2',Ft:'3'}});
 assert.equal(next.qty,283);assert.deepEqual(next.unitQuantities,{CT:1,Box:2,Ft:3});
 assert.equal(quoteLiveUnits(product.unitProfilePreview!,next.unitQuantities!).total,2670);
 assert.equal(next.source.mode,'own');
 assert.throws(()=>patchLiveLineFromSource(old,{unitQuantities:{CT:'1.5'}}),/whole-number/);
});

test('original HisabIQ source cart price equals backend unit quote even if demo price offers exist',()=>{
 const old={product,qty:1,price:10,serialNumbers:[],source:{mode:'own' as const},unitQuantities:{Ft:1}};
 const next=patchLiveLineFromSource(old,{unitQuantities:{CT:'1',Box:'2',Ft:'3'}});
 const sourceLine=toSourceCartLine(next);
 assert.equal(quoteLiveUnits(product.unitProfilePreview!,next.unitQuantities!).total,2670);
 assert.deepEqual(sourceLine.historicalUnitSnapshot?.sellingPrices,{CT:2250,Box:195,Ft:10});
});
