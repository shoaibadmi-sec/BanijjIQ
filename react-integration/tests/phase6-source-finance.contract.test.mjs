import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchSourceFinance} from '../../scripts/preview/patch-source-finance.mjs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const original=read('apps/hisabiq-web/src/pages/Finance.tsx');

test('Phase 6 original HisabIQ Finance keeps its source layout but replaces preview money',()=>{
 const patched=patchSourceFinance(original);
 for(const marker of ['<PageHeader','<MotionTabList','<Table','<FinanceTransactionActionDialog','<FinanceAccountActionDialog','<TransactionDialog']){
  assert.ok(original.includes(marker),'Missing original source: '+marker);
  assert.ok(patched.includes(marker),'Original Finance markup must remain: '+marker);
 }
 assert.match(patched,/usePhase6Finance\(/);
 assert.doesNotMatch(patched,/useSyncExternalStore\(subscribeFinancePreview, getFinancePreviewSnapshot\)/);
 assert.match(patched,/data-live-finance/);
 assert.match(patched,/disabled=\{phase6ReadOnly\}/);
 assert.throws(()=>patchSourceFinance('new unsupported Finance source'),/Finance upstream contract changed/);
});

test('Phase 6 main Finance route must use original source; backend adapter is explicit about unsupported writes',()=>{
 const prep=read('scripts/prepare-hisabiq-react.mjs');
 const hook=read('react-integration/overlay/src/integration/usePhase6Finance.ts');
 assert.match(prep,/patchSourceFinance\(/);
 assert.match(prep,/<Route path="finance" element=\{<Finance \/>\} \/>/);
 assert.doesNotMatch(prep,/<Route path="finance" element=\{<LiveFinance \/>\} \/>/);
 for(const endpoint of ['getFinanceBootstrap(', 'getBankAccounts(', 'getBankReconciliation(', 'getFinancePersonLedger('])
   assert.ok(hook.includes(endpoint),'Finance requires real D1 contract '+endpoint);
 assert.ok(hook.includes("canUseModule("));
 assert.ok(!hook.includes('financePreviewStore'));
});
