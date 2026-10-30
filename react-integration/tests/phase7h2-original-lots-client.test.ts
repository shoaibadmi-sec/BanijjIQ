import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInventoryLots } from '../overlay/src/integration/products/productApi.ts';

test('7H2 original StockLotsView shows real D1 lot fields, not synthetic rows',async()=>{
  const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  const seen:Array<{url:string;method:string;auth:string}>=[];
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'phase7h2-test-token',removeItem:()=>{}}});
    globalThis.fetch=async(input,init)=>{
      seen.push({url:String(input),method:init?.method??'GET',auth:String(new Headers(init?.headers).get('authorization'))});
      return new Response(JSON.stringify({ok:true,lots:[{
        lotId:'L-1',productId:'P-1',sourceType:'PURCHASE',sourceRef:'PUR-1',receivedAt:'2026-10-30 10:00:00',
        originalQuantity:6,remainingQuantity:4,unitCost:25.5,batchNumber:'B-01',expiryDate:'2027-05-15',
        serials:['S001','S002']
      },{
        lotId:'L-2',productId:'P-2',sourceType:'OPENING',sourceRef:null,receivedAt:'2026-10-29 09:00:00',
        originalQuantity:2,remainingQuantity:2,unitCost:10,batchNumber:null,expiryDate:null,serials:[]
      }]}),{status:200,headers:{'content-type':'application/json'}});
    };
    const lots=await loadInventoryLots();
    assert.deepEqual(seen,[{url:'/api/products/inventory-lots',method:'GET',auth:'Bearer phase7h2-test-token'}]);
    assert.deepEqual(lots,[{
      id:'L-1',productId:'P-1',label:'Purchase',receivedAt:'2026-10-30',
      quantity:6,available:4,unitCost:25.5,source:'Purchase',reference:'PUR-1',
      batchNumber:'B-01',expiryDate:'2027-05-15',serials:['S001','S002']
    },{
      id:'L-2',productId:'P-2',label:'Opening',receivedAt:'2026-10-29',
      quantity:2,available:2,unitCost:10,source:'Opening',
      reference:undefined,batchNumber:undefined,expiryDate:undefined,serials:undefined
    }]);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldStorage===undefined)delete globalThis.localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
  }
});

test('7H2 fail closed on impossible lot stock, invalid source, or missing cost',async()=>{
  const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  const row={lotId:'L',productId:'P',sourceType:'PURCHASE',sourceRef:'PUR-1',receivedAt:'2026-10-30',
    originalQuantity:4,remainingQuantity:3,unitCost:15,batchNumber:null,expiryDate:null,serials:[]};
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'phase7h2-test-token',removeItem:()=>{}}});
    for(const mutated of [{...row,remainingQuantity:9},{...row,unitCost:null},{...row,sourceType:'UNKNOWN'},{...row,expiryDate:'malformed'}]){
      globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,lots:[mutated]}),{status:200,headers:{'content-type':'application/json'}});
      await assert.rejects(loadInventoryLots());
    }
  }finally{
    globalThis.fetch=oldFetch;
    if(oldStorage===undefined)delete globalThis.localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
  }
});
