import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('6D finance person ledger uses original financing source API; no demo rows or unverified balances',()=>{
 const api=read('overlay/src/integration/banijjApi.ts');
 const ui=read('overlay/src/integration/LiveFinancePage.tsx');
 assert.match(api,/getFinancePersonLedger/);
 assert.match(api,/postFinanceTransaction/);
 assert.match(api,/\/api\/finance\/persons\//);
 assert.match(api,/\/ledger/);
 assert.match(ui,/getFinancePersonLedger\(/);
 assert.match(ui,/postFinanceTransaction\(/);
 assert.match(ui,/clientRequestId/);
 assert.match(ui,/canUseModule\(user,'finance','add'\)/);
 assert.match(ui,/dateFrom/);
 assert.match(ui,/dateTo/);
 assert.match(ui,/pageSize/);
 assert.match(ui,/needs-review/);
 assert.match(ui,/finance-person-ledger/);
 assert.ok(!ui.includes('Demo Finance'));
});
