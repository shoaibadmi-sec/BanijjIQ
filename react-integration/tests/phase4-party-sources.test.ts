import test from 'node:test';
import assert from 'node:assert/strict';
import {getLivePartyDirectory,getLivePartyLedger} from '../overlay/src/integration/partyApi.ts';

type Reply={status?:number;body:unknown};
async function withApi(responses:Record<string,Reply>,fn:(calls:Array<{url:string;headers:Headers;method:string}>)=>Promise<void>){
 const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
 const calls:Array<{url:string;headers:Headers;method:string}>=[];
 (globalThis as any).localStorage={getItem:(k:string)=>k==='shererp_auth_token'?'phase4k-test-token':null};
 globalThis.fetch=(async (input:RequestInfo|URL,options:RequestInit={})=>{
  const url=String(input),row=responses[url];
  calls.push({url,headers:new Headers(options.headers),method:options.method||'GET'});
  if(!row)throw new Error('Unexpected API request '+url);
  return new Response(JSON.stringify(row.body),{status:row.status??200,headers:{'Content-Type':'application/json'}});
 }) as typeof fetch;
 try{await fn(calls);}finally{globalThis.fetch=originalFetch;(globalThis as any).localStorage=originalStorage;}
}
const customers={ok:true,customers:[{id:'CUS-001',name:'Rahima',phone:'01711111111',currentDue:120,status:'Active'}]};
const suppliers={ok:true,suppliers:[{id:'SUP-001',name:'Hardware Seller',phone:'01811111111',currentDue:75,status:'Active'}]};

test('4K: directory reads only authenticated real customers and suppliers, no cross-offset',async()=>{
 await withApi({'/api/customers':{body:customers},'/api/suppliers':{body:suppliers}},async calls=>{
  const rows=await getLivePartyDirectory();
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>[x.id,x.role,x.balance]),
   [['Customer:CUS-001','Customer',120],['Supplier:SUP-001','Supplier',-75]]);
  assert.ok(calls.every(x=>x.method==='GET'&&x.headers.get('Authorization')==='Bearer phase4k-test-token'));
  assert.deepEqual(calls.map(c=>c.url).sort(),['/api/customers','/api/suppliers']);
 });
});

test('4K: supplier ledger only displays when its D1 debit-credit reconciles with supplier due',async()=>{
 await withApi({'/api/suppliers/SUP-001':{body:{ok:true,
  supplier:{id:'SUP-001',name:'Hardware Seller',currentDue:75},
  ledger:[{ledgerId:'SLED-01',date:'2026-10-30',type:'Purchase',reference:'PUR-01',debit:100,credit:0},
   {ledgerId:'SLED-02',date:'2026-10-31',type:'Payment',reference:'SST-01',debit:0,credit:25}]}}},async calls=>{
  const info=await getLivePartyLedger('Supplier','SUP-001');
  assert.equal(info.balance,75);
  assert.equal(info.rows.length,2);
  assert.equal(info.rows[0].reference,'PUR-01');
  assert.equal(info.rows[1].reference,'SST-01');
  assert.deepEqual(calls.map(c=>c.url),['/api/suppliers/SUP-001']);
 });
});

test('4K: customer page with truncated ledger history must fail closed',async()=>{
 await withApi({'/api/customers/CUS-001?limit=200':{body:{ok:true,
  detail:{customer:{id:'CUS-001',name:'Rahima',currentDue:120},
   ledger:[],history:{matchingCount:250,returnedCount:200,hasMore:true},
   summary:{rangeClosingBalance:120}}}}},async()=>{
  await assert.rejects(()=>getLivePartyLedger('Customer','CUS-001'),/truncated|incomplete|history/i);
 });
});

test('4K: unreconciled supplier ledger never becomes a verified payable',async()=>{
 await withApi({'/api/suppliers/SUP-001':{body:{ok:true,
  supplier:{id:'SUP-001',name:'Hardware Seller',currentDue:95},
  ledger:[{ledgerId:'SLED-01',date:'2026-10-30',type:'Purchase',reference:'PUR-01',debit:100,credit:0}]}}},async()=>{
  await assert.rejects(()=>getLivePartyLedger('Supplier','SUP-001'),/reconcil|mismatch/i);
 });
});

test('4K: authorization failure never falls back to demo party data',async()=>{
 await withApi({'/api/customers':{status:403,body:{ok:false,error:'Customers permission required'}},
  '/api/suppliers':{body:suppliers}},async()=>{
  await assert.rejects(()=>getLivePartyDirectory(),/Customers permission required/);
 });
});
