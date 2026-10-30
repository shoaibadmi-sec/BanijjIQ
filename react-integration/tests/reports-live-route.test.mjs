import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url),'utf8');

test('real Reports route is authenticated and exposes only two main tabs',()=>{
 const prepare=read('scripts/prepare-hisabiq-react.mjs');
 assert.match(prepare,/const reportsAnchor = '<Route path="reports" element=\{<Reports \/>\} \/>'/);
 assert.match(prepare,/LiveReportsPage/);
 assert.match(prepare,/reports-design-preview/);
 const reports=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 assert.match(reports,/canUseModule\(user,\s*'reports'/);
 assert.match(reports,/getLiveReportCatalog/);
 assert.match(reports,/getLiveReportRows/);
 assert.match(reports,/reportCatalog/);
 assert.match(reports,/Dashboard/);
 assert.match(reports,/Report Library/);
 assert.doesNotMatch(reports,/useReportData\(/);
 assert.doesNotMatch(reports,/MagicReportsView/);
});
test('live report adapter only performs authenticated GET requests',()=>{
 const api=read('react-integration/overlay/src/integration/banijjApi.ts');
 assert.match(api,/export const getLiveReportCatalog/);
 assert.match(api,/export const getLiveReportRows/);
 assert.match(api,/\/api\/reports\/v2\/catalog/);
 assert.match(api,/\/api\/reports\/v2\/rows/);
});

test('current stock and dues appear inside Dashboard, not as extra main tabs',()=>{
 const source=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 for(const metric of ['inventoryValue','receivablesBalance','payablesBalance'])
   assert.ok(source.includes("data-current-balance={item.key}"),'current source-aware cards expected');
 assert.match(source,/Current balances/);
 assert.match(source,/metric\?\.status==='needs-review'/);
 assert.match(source,/metric\?\.valueMinor!==null/);
});

test('live stock/dues tables label current values and show row reconciliation status',()=>{
 const source=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 assert.match(source,/const currentReport=key==='stock'\|\|key==='receivables'\|\|key==='payables'/);
 assert.match(source,/row\.status==='incomplete'/);
 assert.match(source,/title=\{row\.reason\}/);
 assert.match(source,/Current due/);
 assert.match(source,/Current FIFO value/);
});

test('Dashboard period changes clear previous metric values before loading new sources',()=>{
 const source=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 assert.match(source,/setSummaryMetrics\(\[\]\)/);
 assert.match(source,/setSummaryStatus\('Loading current reporting evidence/);
});

test('cash and finance remain inside Report Library with explicit money in/out columns and source-linked metrics',()=>{
 const reports=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 assert.match(reports,/finance-movements':'finance'/);
 assert.match(reports,/const moneyMovement=key==='cash'\|\|key==='bank'\|\|key==='finance'/);
 assert.match(reports,/Money in/);
 assert.match(reports,/Money out/);
 assert.match(reports,/data-report-metric=/);
 assert.match(reports,/Current ledger snapshot/);
});
