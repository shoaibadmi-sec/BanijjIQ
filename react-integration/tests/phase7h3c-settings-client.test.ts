import test from 'node:test';
import assert from 'node:assert/strict';
import {
 loadProductSettingsLookups,createProductSettingsLookup,
 setProductSettingsLookupStatus,deleteProductSettingsLookup
} from '../overlay/src/integration/products/productSettingsApi.ts';

test('7H3C original settings use only authenticated D1 requests, no optimistic fake mutations',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
 const calls:Array<{method:string;url:string;auth:string;body:unknown}>=[];
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'test-auth-token',removeItem:()=>{}}});
  globalThis.fetch=async(input,init)=>{
   const method=init?.method??'GET';const url=String(input);
   calls.push({method,url,auth:new Headers(init?.headers).get('authorization')||'',body:init?.body?JSON.parse(String(init.body)):null});
   const response=url.endsWith('/lookups')&&method==='GET'?
    {ok:true,categories:[{id:'CAT-1',name:'Hardware',nameBn:'হার্ডওয়্যার',usage:2,active:true}],brands:[],units:[]}:
    {ok:true,item:{id:'CAT-2',name:'New',usage:0,active:true}};
   return new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}});
  };
  const lookups=await loadProductSettingsLookups();
  assert.equal(lookups.categories[0].nameBn,'হার্ডওয়্যার');
  await createProductSettingsLookup({kind:'category',name:'New',nameBn:'নতুন'});
  await setProductSettingsLookupStatus('category','CAT-1','Inactive');
  await deleteProductSettingsLookup('category','CAT-1');
  assert.deepEqual(calls.map(x=>[x.method,x.url]),[
   ['GET','/api/products/settings/lookups'],
   ['POST','/api/products/settings/lookups'],
   ['PUT','/api/products/settings/lookups/category/CAT-1/status'],
   ['DELETE','/api/products/settings/lookups/category/CAT-1']
  ]);
  assert.deepEqual(calls[1].body,{kind:'category',name:'New',nameBn:'নতুন'});
  assert.deepEqual(calls[2].body,{status:'Inactive'});
  assert.ok(calls.every(c=>c.auth==='Bearer test-auth-token'),'all operations authenticated');
  await assert.rejects(createProductSettingsLookup({kind:'unit',name:'Box',symbol:'bad symbol'}),/symbol/i);
  assert.equal(calls.length,4,'malformed input rejected before D1 write');
 }finally{
  globalThis.fetch=oldFetch;
  if(oldStorage===undefined)delete globalThis.localStorage;
  else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
 }
});

test('7H3C rejected DELETE never counts as a successful settings change',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'test-auth-token',removeItem:()=>{}}});
  globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error:'Lookup referenced by product'}),{status:409,headers:{'content-type':'application/json'}});
  await assert.rejects(deleteProductSettingsLookup('brand','BRD-1'),/Lookup referenced by product/);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldStorage===undefined)delete globalThis.localStorage;
  else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage});
 }
});
