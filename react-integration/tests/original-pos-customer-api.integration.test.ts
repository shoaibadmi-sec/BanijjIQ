import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOriginalPosCustomers} from '../overlay/src/integration/originalPosCustomers';

const customer=(changes:Record<string,unknown>={})=>({
  id:'CUST-REAL-001',name:'Real Hardware Customer',phone:'01700123456',
  fatherName:'Abdul',address:'Nawabpur',currentDue:450,...changes
});
const response=(customers:unknown[])=>({ok:true,products:[],customers,bankAccounts:[],vendors:[],activeSession:null,invoiceDesign:{settings:{},logoDataUri:''}});
test('original HisabIQ customer picker receives real backend customer identity and current due',async()=>{
  let calls=0;
  const customers=await loadOriginalPosCustomers(async()=>{calls++;return response([customer()]) as never;});
  assert.equal(calls,1);
  assert.deepEqual(customers.map(p=>({id:p.id,name:p.name,phone:p.phone,area:p.area,balance:p.balance,roles:p.roles})),[
    {id:'CUST-REAL-001',name:'Real Hardware Customer',phone:'01700123456',
      area:'Nawabpur',balance:450,roles:['Customer']}
  ]);
  assert.equal(customers[0].status,'Active');
  assert.notEqual(customers[0].id,'c1','must not inject demo customer');
});
test('invalid or unavailable backend identity and due fail closed, never fall back to fake Party records',async()=>{
  await assert.rejects(()=>loadOriginalPosCustomers(async()=>{throw new Error('Network offline');}),/Network offline/);
  await assert.rejects(()=>loadOriginalPosCustomers(async()=>response([customer({currentDue:NaN})]) as never),/due/i);
  await assert.rejects(()=>loadOriginalPosCustomers(async()=>response([customer({id:''})]) as never),/identity/i);
  await assert.rejects(()=>loadOriginalPosCustomers(async()=>response([customer(),customer({name:'Another'})]) as never),/duplicate/i);
  await assert.rejects(()=>loadOriginalPosCustomers(async()=>({...response([]),customers:null}) as never),/customers/i);
});
