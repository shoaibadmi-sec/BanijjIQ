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

test('source-linked Sales Register opens authenticated invoice read-only, without a demo receipt',()=>{
 const reports=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 assert.match(reports,/getPosInvoice\(/);
 assert.match(reports,/row\.sourceModule==='sales'/);
 assert.match(reports,/canUseModule\(user,\s*'pos',\s*'view'\)/);
 assert.match(reports,/DialogTitle/);
 assert.match(reports,/Recorded invoice/);
 assert.doesNotMatch(reports,/Nawabpur Hardware House/);
});

test('report pagination offers a bounded direct page jump alongside 50/100-size controls',()=>{
 const reports=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 assert.match(reports,/name="report-page"/);
 assert.match(reports,/aria-label=\{text\('Go to page'/);
 assert.match(reports,/Math\.ceil\(rows\.totalRows\/pageSize\)/);
 assert.match(reports,/type="number"/);
});

test('product gross profit and Profit & Loss have distinct unavailable contracts, not invoice-cohort profit',()=>{
 const reports=read('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 const api=read('react-integration/overlay/src/integration/banijjApi.ts');
 assert.match(reports,/'product-profit':'product-profit'/);
 assert.match(reports,/'profit-loss':'profit-loss'/);
 assert.doesNotMatch(reports,/'product-profit':'profit'/);
 assert.doesNotMatch(reports,/'profit-loss':'profit'/);
 assert.match(api,/\|'product-profit'/);
 assert.match(api,/\|'profit-loss'/);
 assert.match(reports,/coverage\?\.status==='unavailable'/);
});

test('5H1: production Reports route uses the pinned HisabIQ Reports component with authenticated backend data',()=>{
 const prepare=read('scripts/prepare-hisabiq-react.mjs');
 assert.doesNotMatch(prepare, /<Route path="reports" element=\{<LiveReports \/>\}/,
  'Live Reports must not replace the HisabIQ UI report screen');
 assert.match(prepare, /<Route path="reports" element=\{<Reports \/>\}/);
 const patch=read('scripts/preview/patch-reports-two-tabs.mjs');
 assert.match(patch, /useLiveReportResult/,
  'original Reports must use an authenticated backend result adapter, not preview-store report totals');
 assert.doesNotMatch(patch, /useReportData\(refresh\)/,
  'reports must not read the original preview-store data hook');
 const adapter=read('react-integration/overlay/src/integration/liveReportAdapter.ts');
 assert.match(adapter, /getLiveReportRows\(/);
 assert.doesNotMatch(adapter, /erpDemoStore|salesPreviewStore|useReportData\(/);
});
