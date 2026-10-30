import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Phase 6A preserves original Finance destination with a permission-gated live view', () => {
  const prep=read('../scripts/prepare-hisabiq-react.mjs');
  assert.match(prep,/const LiveFinance = lazy\(/);
  assert.match(prep,/<Route path="finance" element=\{<LiveFinance \/>\} \/>/);
  assert.ok(prep.includes('LiveFinancePage'));
  const page=read('overlay/src/integration/LiveFinancePage.tsx');
  assert.ok(page.includes('canUseModule(user,\'finance\',\'view\')'));
  assert.ok(page.includes('canUseModule(user,\'bank\',\'view\')'));
  assert.ok(page.includes('getBankReconciliation()'));
  assert.ok(page.includes('getFinanceBootstrap()'));
  assert.ok(page.includes('bookBalance'));
  assert.ok(page.includes('needs-review'));
  assert.ok(!page.includes('financePreviewStore'), 'demo accounts must never appear as live');
  assert.ok(!page.includes('seedAccounts'));
});

test('Phase 6A uses existing authenticated request adapter and separated permissions',()=>{
  const api=read('overlay/src/integration/banijjApi.ts');
  assert.ok(api.includes("'/api/bank/reconciliation'"));
  assert.ok(api.includes("'/api/finance/bootstrap'"));
  assert.ok(!api.includes('localStorage.setItem(\'finance'));
});
