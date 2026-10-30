import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInventoryHistory } from '../overlay/src/integration/products/productApi.ts';

test('7H1 original StockHistoryView receives source movements, not demo data',async()=>{
  const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  const calls:Array<{url:string;method:string;auth:string}>=[];
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'phase7h1-test-token',removeItem:()=>{}}});
    globalThis.fetch=async(input,init)=>{
      calls.push({url:String(input),method:init?.method??'GET',auth:String(new Headers(init?.headers).get('authorization'))});
      return new Response(JSON.stringify({ok:true,items:[
        {movementId:'M-A',productId:'P-A',date:'2026-10-30 10:00:00',type:'STOCK_IN_ADJUSTMENT',quantityIn:2,quantityOut:0,balanceAfter:5,note:'Counted',lotId:'LOT-A'},
        {movementId:'M-B',productId:'P-B',date:'2026-10-30 11:00:00',type:'STOCK_OUT_ADJUSTMENT',quantityIn:0,quantityOut:3,balanceAfter:4,note:'Damage',lotId:null}
      ]}),{status:200,headers:{'Content-Type':'application/json'}});
    };
    const rows=await loadInventoryHistory();
    assert.deepEqual(calls,[{url:'/api/products/inventory-history',method:'GET',auth:'Bearer phase7h1-test-token'}]);
    assert.deepEqual(rows,[{
      id:'M-A',productId:'P-A',date:'2026-10-30',type:'Adjustment',quantity:2,balance:5,reference:'LOT-A',note:'Counted'
    },{
      id:'M-B',productId:'P-B',date:'2026-10-30',type:'Adjustment',quantity:-3,balance:4,reference:undefined,note:'Damage'
    }]);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldStorage===undefined)delete globalThis.localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
  }
});
test('7H1 corrupt or unrecognized movement data fails closed instead of fabricating UI history',async()=>{
  const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'phase7h1-test-token',removeItem:()=>{}}});
    for(const row of [
      {movementId:'M-BAD',productId:'P',date:'2026-10-30',type:'MYSTERY',quantityIn:1,quantityOut:0,balanceAfter:1},
      {movementId:'M-NEG',productId:'P',date:'2026-10-30',type:'SALE',quantityIn:0,quantityOut:-3,balanceAfter:2},
      {movementId:'M-DOUBLE',productId:'P',date:'2026-10-30',type:'PURCHASE',quantityIn:3,quantityOut:2,balanceAfter:4}
    ]){
      globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,items:[row]}),{status:200,headers:{'Content-Type':'application/json'}});
      await assert.rejects(loadInventoryHistory());
    }
  }finally{
    globalThis.fetch=oldFetch;
    if(oldStorage===undefined)delete globalThis.localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
  }
});

test('7H1 negative-sale stock balances are genuine signed quantities, never suppressed',async()=>{
  const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
  try{
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'phase7h1-test-token',removeItem:()=>{}}});
    globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,items:[{
      movementId:'M-NEG-SALE',productId:'P-A',date:'2026-10-30 11:00:00',
      type:'SALE_OUT',quantityIn:0,quantityOut:3,balanceAfter:-2,note:'Verified negative sale',lotId:null
    }]}),{status:200,headers:{'Content-Type':'application/json'}});
    const history=await loadInventoryHistory();
    assert.equal(history.length,1);
    assert.equal(history[0].type,'Sale');
    assert.equal(history[0].quantity,-3);
    assert.equal(history[0].balance,-2);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldStorage===undefined)delete globalThis.localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
  }
});
