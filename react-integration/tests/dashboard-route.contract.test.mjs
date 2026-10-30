import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchLiveDashboard} from '../../scripts/preview/patch-live-dashboard.mjs';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('original Dashboard JSX and widget layout remain intact while all five demo data widget imports are replaced',()=>{
  const original=read('apps/hisabiq-web/src/pages/Dashboard.tsx');
  const patched=patchLiveDashboard(original);
  for(const name of ['MetricCard','SalesTrendChart','CashflowChart','RecentSalesTable','DuesList']){
    assert.ok(patched.includes(name),'original widget remains: '+name);
  }
  assert.match(patched,/integration\/LiveDashboardWidgets/);
  assert.doesNotMatch(patched,/components\/dashboard\/(MetricCard|SalesTrendChart|CashflowChart|RecentSalesTable|DuesList)'/);
  assert.doesNotMatch(patched,/Sample figures|নমুনার হিসাব/);
  assert.match(patched,/useDashboardLayout\(\)/);
  assert.match(patched,/CustomizeDialog/);
  assert.match(patched,/data-live-dashboard/);
});
test('generated app uses live Dashboard route and preserves original design preview separately',()=>{
  const prepare=read('scripts/prepare-hisabiq-react.mjs');
  assert.match(prepare,/patchLiveDashboard\(/);
  assert.match(prepare,/LiveDashboardPage/);
  assert.match(prepare,/dashboard-design-preview/);
});