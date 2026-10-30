import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('Phase 5G1 exercises authenticated report v2 routes against the isolated real Worker and D1',()=>{
 const d1=source('d1-checks/run.mjs');
 assert.match(d1,/real D1 reports verify permissions, source parity and no writes/);
 for(const report of ['sales','stock','receivables','cash','expenses','finance'])
   assert.ok(d1.includes('report='+report)||d1.includes("'"+report+"'"),'D1 source check missing '+report);
 assert.match(d1,/\/api\/reports\/v2\/summary/);
 assert.match(d1,/\/api\/reports\/v2\/audit/);
 assert.match(d1,/sourceId/);
 assert.match(d1,/reportBefore/);
 assert.match(d1,/reportAfter/);
 assert.match(d1,/403/);
});

test('Phase 5G1 keeps reports behind auth/RBAC and CI tests without extra reporting modules',()=>{
 const handler=source('server/core/handler.ts');
 const permissions=source('server/modules/auth/permissions.ts');
 const workflow=source('.github/workflows/hisabiq-react-build.yml');
 const react=source('react-integration/overlay/src/integration/LiveReportsPage.tsx');
 assert.ok(handler.indexOf('requireUser(')<handler.indexOf('handleReportingRoute('));
 assert.ok(handler.indexOf('enforceRequestPermission(')<handler.indexOf('handleReportingRoute('));
 assert.match(permissions,/\^\\\/api\\\/reports/);
 assert.match(workflow,/node --test react-integration\/tests\/reports-source-parity\.test\.mjs/);
 assert.match(workflow,/node d1-checks\/run\.mjs/);
 assert.match(react,/Report Library/);
 assert.match(react,/Dashboard/);
 assert.doesNotMatch(react,/<AuditBook/);
});

test('Phase 5G7 release gate cannot silently treat local CI as production acceptance',()=>{
 const doc=source('docs/superpowers/phase5-reports-release-acceptance.md');
 assert.match(doc,/Decision: HOLD hosted\/production release/);
 assert.match(doc,/Phase 5F remains deferred/);
 assert.match(doc,/Issue #35/);
 for(const pr of ['#20','#21','#28'])
   assert.ok(doc.includes(pr),'missing explicit unmerged accounting dependency '+pr);
 assert.match(doc,/intentionally skipped/);
 assert.match(doc,/PR-head local CI/);
 assert.ok(doc.includes('product-profit')&&doc.includes('profit-loss'));
 assert.match(doc,/No report GET writes to D1/);
});
