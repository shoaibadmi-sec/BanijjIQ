import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('6E native React Daybook is permission-gated and source-backed with no demo fallback',()=>{
 const api=read('overlay/src/integration/banijjApi.ts');
 const ui=read('overlay/src/integration/LiveDaybookPage.tsx');
 const prepare=read('../scripts/prepare-hisabiq-react.mjs');
 assert.match(api,/getLiveDaybook/);
 assert.match(api,/\/api\/daybook\?/);
 assert.match(ui,/canUseModule\(user,\s*'daybook'/);
 assert.match(ui,/getLiveDaybook\(/);
 assert.match(ui,/dateFrom/);
 assert.match(ui,/dateTo/);
 assert.match(ui,/pageSize/);
 assert.match(ui,/sortBy/);
 assert.match(ui,/window\.print\(/);
 assert.match(ui,/sourceId/);
 assert.ok(!ui.includes('Demo Daybook'));
 assert.match(prepare,/LiveDaybookPage/);
 assert.match(prepare,/daybook/);
});
