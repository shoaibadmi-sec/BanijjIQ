import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('6E main Daybook route uses a real authenticated source-backed page',()=>{
 const prepare=read('../scripts/prepare-hisabiq-react.mjs');
 const api=read('overlay/src/integration/banijjApi.ts');
 const page=read('overlay/src/integration/LiveDaybookPage.tsx');
 assert.match(prepare,/LiveDaybookPage/);
 assert.match(prepare,/<Route path="daybook" element=\{<LiveDaybook \/>\} \/>/);
 assert.match(prepare,/daybook-design-preview/);
 assert.match(api,/getLiveDaybookRows/);
 assert.match(api,/getLiveDaybookBootstrap/);
 assert.match(page,/canUseModule\(user,'daybook','view'\)/);
 assert.match(page,/getLiveDaybookRows\(/);
 assert.match(page,/dateFrom/);
 assert.match(page,/dateTo/);
 assert.match(page,/sortBy/);
 assert.match(page,/pageSize/);
 assert.match(page,/sourceModule/);
 assert.match(page,/sourceId/);
 assert.ok(!page.includes('daybookDemoStore'));
});
