import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('6B live Finance transfer uses only authenticated backend posting with request identity',()=>{
  const api=read('overlay/src/integration/banijjApi.ts');
  const page=read('overlay/src/integration/LiveFinancePage.tsx');
  assert.match(api,/getBankAccounts/);
  assert.match(api,/getBankTransfers/);
  assert.match(api,/postBankTransfer/);
  assert.match(api,/reverseBankTransfer/);
  assert.ok(api.includes("'/api/bank/transfers'"));
  assert.ok(page.includes("canUseModule(user,'bank','add')"));
  assert.ok(page.includes("canUseModule(user,'bank','edit')"));
  assert.ok(page.includes('clientRequestId'));
  assert.ok(page.includes('crypto.randomUUID()'));
  assert.ok(page.includes('postBankTransfer('));
  assert.ok(page.includes('reverseBankTransfer('));
  assert.ok(page.includes('getBankTransfers()'));
  assert.ok(page.includes('Retry same request'));
  assert.ok(!page.includes('updateFinancePreview('),'mock financial state must not be posted');
});
