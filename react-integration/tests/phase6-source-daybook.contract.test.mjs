import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchSourceDaybook} from '../../scripts/preview/patch-source-daybook.mjs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const upstream=read('apps/hisabiq-web/src/pages/Daybook.tsx');

test('original Phase 6 Daybook reuses source JSX and loads only server-posted transactions',()=>{
 const patched=patchSourceDaybook(upstream);
 for(const marker of ['<DaybookFilters','<Table>','<DaybookActions','<TransactionDetailsDialog','<PageHeader','exportDaybook','cashflowSummary'])
   assert.ok(upstream.includes(marker)&&patched.includes(marker),'Lost approved source UI: '+marker);
 assert.ok(patched.includes('usePhase6Daybook('),'must bind the real API');
 assert.ok(!patched.includes('useState<UnifiedTransaction[]>(daybookTransactions)'),'cannot read demo transactions');
 assert.ok(patched.includes('pageSize={pageSize}'),'must expose server pagination');
 assert.ok(patched.includes('readOnlyLive'),'demo permissions cannot authorize mutations');
 assert.throws(()=>patchSourceDaybook('UI upstream changed'),/Daybook upstream contract changed/);
});
test('normal Finance and Daybook routes may not point at duplicated Live* JSX',()=>{
 const prep=read('scripts/prepare-hisabiq-react.mjs');
 assert.ok(prep.includes('patchSourceDaybook('));
 assert.ok(prep.includes('<Route path="daybook" element={<Daybook />} />'));
 assert.ok(!prep.includes('<Route path="daybook" element={<LiveDaybook />} />'));
 const hook=read('react-integration/overlay/src/integration/usePhase6Daybook.ts');
 for(const x of ['getLiveDaybookRows(', 'canUseModule(', 'toUnifiedDaybookRow'])
   assert.ok(hook.includes(x),x);
});
