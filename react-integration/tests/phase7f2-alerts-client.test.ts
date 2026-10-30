import test from 'node:test';
import assert from 'node:assert/strict';
import { getStockAlerts } from '../overlay/src/integration/banijjApi.ts';

test('Phase 7F2 client: live stock-alert GET uses authorized relative API, correct filters and no writes',async()=>{
  const originalFetch=globalThis.fetch;
  const originalStorage=(globalThis as any).localStorage;
  const calls:Array<{url:string;options:RequestInit}>=[];
  (globalThis as any).localStorage={getItem:()=> 'local-demo-session-token'};
  globalThis.fetch=(async(url:RequestInfo | URL,options?:RequestInit)=>{
    calls.push({url:String(url),options:options||{}});
    return new Response(JSON.stringify({ok:true,asOf:'2026-10-30',horizonDays:7,page:1,pageSize:50,totalAlerts:1,
      counts:{outOfStock:0,lowStock:0,expired:1,expiring:0,needsReview:0},
      alerts:[{kind:'expired',productId:'P-1',productName:'Cable',currentStock:1,minimumStock:0,
        sourceStatus:'ready',expiryDate:'2026-10-29',expiryBatchId:'E-1',lotId:'L-1',quantity:1}]}),{status:200,
      headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  try {
    const value=await getStockAlerts({asOf:'2026-10-30',days:7,page:1,pageSize:50});
    assert.equal(value.alerts[0].expiryBatchId,'E-1');
    assert.equal(value.counts.expired,1);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'/api/products/stock-alerts?asOf=2026-10-30&days=7&page=1&pageSize=50');
    assert.equal(calls[0].options.method,undefined,'reads must not POST');
    assert.equal(calls[0].options.credentials,'same-origin');
    assert.equal(new Headers(calls[0].options.headers).get('authorization'),'Bearer local-demo-session-token');
  }finally{
    globalThis.fetch=originalFetch;
    (globalThis as any).localStorage=originalStorage;
  }
});
