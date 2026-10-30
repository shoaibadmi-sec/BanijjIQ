import test from 'node:test';
import assert from 'node:assert/strict';
import {attachOriginalPosUnitProfiles} from '../overlay/src/integration/originalPosCatalog';
import type {Product} from '../overlay/src/types/erp';
import type {PosBootstrap, PosProduct} from '../overlay/src/integration/banijjApi';

const product=(id='D1-P100'):Product=>({
  id,kind:'Stock',name:'Verified Cable',unit:'Pcs',sku:id,category:'Electrical',
  stock:400,minStock:2,sellPrice:10,purchasePrice:5,active:true
});
const live=(id='D1-P100',patch:Partial<PosProduct>={}):PosProduct=>({
  id,name:'Verified Cable',productName:'Verified Cable',brand:'',category:'Electrical',
  unit:'Pcs',barcode:id,sellingPrice:10,stock:283,minimumStock:2,
  trackSerial:false,trackExpiry:false,trackWarranty:false,...patch
});
const three=[
  {unit:'Carton',symbol:'CT',factor:240,containsNext:12,sellingPrice:2100},
  {unit:'Box',symbol:'BOX',factor:20,containsNext:20,sellingPrice:180},
  {unit:'Pcs',symbol:'PCS',factor:1,containsNext:null,sellingPrice:10}
];
const bootstrap=(products:PosProduct[]):PosBootstrap=>({
  ok:true,products,customers:[],bankAccounts:[],vendors:[],activeSession:null,
  invoiceDesign:{settings:{},logoDataUri:''}
});

test('original POS uses the exact existing 3-unit chain and backend prices, with authoritative sellable stock',()=>{
  const result=attachOriginalPosUnitProfiles([product()],bootstrap([
    live('D1-P100',{unitProfilePreview:{baseUnit:'Pcs',revision:2,postingEnabled:true,units:three}})
  ]));
  assert.equal(result.length,1);
  assert.deepEqual(result[0].unitRelations,[
    {leftUnit:'Carton',rightUnit:'Box',quantity:12},
    {leftUnit:'Box',rightUnit:'Pcs',quantity:20}
  ]);
  assert.deepEqual(result[0].unitSellPrices,{Carton:2100,Box:180,Pcs:10});
  assert.equal(result[0].unit,'Pcs');
  assert.equal(result[0].stockViewUnit,'Carton');
  assert.equal(result[0].stock,283);
  assert.equal(result[0].sellPrice,10);
  const factors={Carton:12*20,Box:20,Pcs:1};
  assert.equal(1*factors.Carton+2*factors.Box+3*factors.Pcs,283);
});

test('original cart supports 4-unit and 2-unit profiles without adding or changing any quantity UI',()=>{
  const four=[
    {unit:'Pallet',symbol:'PL',factor:2400,containsNext:10,sellingPrice:18000},
    {unit:'Carton',symbol:'CT',factor:240,containsNext:12,sellingPrice:2000},
    {unit:'Box',symbol:'BOX',factor:20,containsNext:20,sellingPrice:175},
    {unit:'Pcs',symbol:'PCS',factor:1,containsNext:null,sellingPrice:10}
  ];
  const two=[{unit:'Box',symbol:'BOX',factor:20,containsNext:20,sellingPrice:175},four[3]];
  const data=attachOriginalPosUnitProfiles([product('four'),product('two')],bootstrap([
    live('four',{unitProfilePreview:{baseUnit:'Pcs',revision:3,postingEnabled:true,units:four}}),
    live('two',{unitProfilePreview:{baseUnit:'Pcs',revision:1,postingEnabled:true,units:two}})
  ]));
  assert.deepEqual(data[0].unitRelations?.map(x=>x.quantity),[10,12,20]);
  assert.deepEqual(data[1].unitRelations,[{leftUnit:'Box',rightUnit:'Pcs',quantity:20}]);
  assert.equal(data[0].unitSellPrices?.Pallet,18000);
});

test('no demo/unsupported products: hide products absent from POS or with disabled unit posting',()=>{
  const data=attachOriginalPosUnitProfiles([product('missing'),product('disabled'),product('single')],bootstrap([
    live('disabled',{unitProfilePreview:{baseUnit:'Pcs',revision:1,postingEnabled:false,units:three}}),
    live('single',{stock:9})
  ]));
  assert.deepEqual(data.map(x=>x.id),['single']);
  assert.equal(data[0].stock,9);
  assert.equal(data[0].unitRelations,undefined);
});

test('invalid D1 chains and mismatch fail closed; never silently invent conversions',()=>{
  const bad=(patch:Partial<PosProduct>)=>()=>attachOriginalPosUnitProfiles([product()],bootstrap([live('D1-P100',patch)]));
  const profile=(units:typeof three,other:Record<string,unknown>={})=>({baseUnit:'Pcs',revision:3,postingEnabled:true,units,...other});
  assert.throws(bad({unit:'Feet'}),/base unit/i);
  assert.throws(bad({stock:NaN}),/stock/i);
  assert.throws(bad({unitProfilePreview:profile([{...three[0],factor:200},three[1],three[2]])}),/factor/i);
  assert.throws(bad({unitProfilePreview:profile([{...three[0],containsNext:0},three[1],three[2]])}),/conversion/i);
  assert.throws(bad({unitProfilePreview:profile([three[0],{...three[1],unit:'Carton'},three[2]])}),/duplicate/i);
  assert.throws(bad({unitProfilePreview:profile([three[0],three[1],{...three[2],sellingPrice:-1}])}),/price/i);
  assert.throws(bad({unitProfilePreview:profile(three,{revision:0})}),/revision/i);
  assert.throws(()=>attachOriginalPosUnitProfiles([product()],bootstrap([live(),live()])),/duplicate/i);
});
