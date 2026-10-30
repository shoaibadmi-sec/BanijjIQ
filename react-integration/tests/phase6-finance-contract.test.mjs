import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Phase 6A original Finance destination reads authenticated sources, never preview balances',()=>{
 const prep=read('../scripts/prepare-hisabiq-react.mjs');
 assert.match(prep,/patchSourceFinance\(/);
 assert.match(prep,/<Route path="finance" element=\{<Finance \/>\} \/>/);
 assert.doesNotMatch(prep,/<Route path="finance" element=\{<LiveFinance \/>\} \/>/);
 const patch=read('../scripts/preview/patch-source-finance.mjs');
 const hook=read('overlay/src/integration/usePhase6Finance.ts');
 assert.match(patch,/usePhase6Finance/);
 assert.match(patch,/phase6ReadOnly/);
 assert.match(patch,/Number.NaN/);
 for(const fragment of [
  "canUseModule(user,'finance','view')",
  "canUseModule(user,'bank','view')",
  "getBankReconciliation()","getFinanceBootstrap()","getBankAccounts()",
  "getBankTransfers()","getFinancePersonLedger(","verified.bookBalance"
 ])assert.ok(hook.includes(fragment),fragment);
 assert.ok(!hook.includes('financePreviewStore'));
 assert.ok(!hook.includes('seedAccounts'));
});
test('Phase 6A uses existing authenticated bank/finance API and never writes preview accounts',()=>{
 const api=read('overlay/src/integration/banijjApi.ts');
 assert.ok(api.includes("'/api/bank/reconciliation'"));
 assert.ok(api.includes("'/api/finance/bootstrap'"));
 assert.ok(!api.includes("localStorage.setItem('finance"));
});
