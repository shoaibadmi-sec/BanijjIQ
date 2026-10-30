import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('6C cash count stays source-backed and two-step confirmed',()=>{
 const api=read('overlay/src/integration/banijjApi.ts');
 const page=read('overlay/src/integration/LiveFinancePage.tsx');
 for(const marker of ['getCashSessionSummary','closeCashSession','startCashSession'])assert.ok(api.includes(marker),marker);
 assert.ok(api.includes("'/api/pos/cash-session/summary'"));
 assert.ok(api.includes("'/api/pos/cash-session/close'"));
 assert.ok(page.includes('LiveCashSessionPanel'));
 assert.ok(page.includes('getCashSessionSummary()'));
 assert.ok(page.includes('closeCashSession('));
 assert.ok(page.includes('canUseModule(user,\'pos\',\'view\')'));
 assert.ok(page.includes('canUseModule(user,\'pos\',\'add\')'));
 assert.ok(page.includes('canUseModule(user,\'pos\',\'edit\')'));
 assert.ok(api.includes('clientRequestId'), 'API includes stable request key');
 assert.ok(page.includes('startRequestId')&&page.includes('closeRequestId'),
  'start and close retain distinct stable request keys across retries');
 assert.ok(page.includes('countedCash'));
 assert.ok(page.includes('expectedCash'));
 assert.ok(page.includes('Review close'));
 assert.ok(!page.includes('financePreviewStore'),'never close demo cash');
});
