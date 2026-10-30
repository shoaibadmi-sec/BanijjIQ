import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('6E main Daybook uses original HisabIQ source JSX backed by authenticated D1 rows',()=>{
 const prepare=read('../scripts/prepare-hisabiq-react.mjs');
 const api=read('overlay/src/integration/banijjApi.ts');
 const patch=read('../scripts/preview/patch-source-daybook.mjs');
 const hook=read('overlay/src/integration/usePhase6Daybook.ts');
 const adapter=read('overlay/src/integration/phase6DaybookAdapter.ts');
 assert.match(prepare,/patchSourceDaybook\(/);
 assert.match(prepare,/<Route path="daybook" element=\{<Daybook \/>\} \/>/);
 assert.doesNotMatch(prepare,/<Route path="daybook" element=\{<LiveDaybook \/>\} \/>/);
 assert.match(api,/getLiveDaybookRows/);
 assert.match(api,/getLiveDaybookBootstrap/);
 assert.match(hook,/canUseModule\(user,'daybook','view'\)/);
 assert.match(hook,/getLiveDaybookRows\(/);
 assert.match(hook,/dateFrom/);
 assert.match(hook,/dateTo/);
 assert.match(hook,/sortBy/);
 assert.match(hook,/pageSize/);
 assert.match(adapter,/sourceModule/);
 assert.match(adapter,/sourceId/);
 assert.match(patch,/readOnlyLive/);
 assert.doesNotMatch(patch,/setTransactions\(\(current\)/);
 assert.ok(!hook.includes('daybookTransactions'));
});
