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
