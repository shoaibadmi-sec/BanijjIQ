import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchSourceFinance} from '../../scripts/preview/patch-source-finance.mjs';
import {patchSourceFinanceTransfer} from '../../scripts/preview/patch-source-finance-transfer.mjs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const source=read('apps/hisabiq-web/src/pages/Finance.tsx');

test('source Finance transfer dialog awaits one real API posting before closing',()=>{
 const page=patchSourceFinanceTransfer(patchSourceFinance(source));
 assert.match(page,/postBankTransfer\(/);
 assert.match(page,/clientRequestId/);
 assert.match(page,/const save = async \(\) =>/);
 assert.match(page,/await onSave\(/);
 assert.match(page,/disabled=\{pending\}/);
 assert.match(page,/date: businessToday\(\)/);
 assert.match(page,/const payload=toVerifiedTransferPost\(transfer,clientRequestId\)/, 'Server posting must use source account IDs and stable request ID, not preview transfer ID');
 const adapter=read('react-integration/overlay/src/integration/phase6FinancePosting.ts');
 assert.match(adapter,/toVerifiedTransferPost/);
 assert.match(adapter,/Number.isSafeInteger/);
 assert.match(adapter,/const minor4=transfer.amount\*10000/);
 assert.match(adapter,/const ticks=Math.round\(minor4\)/);
});
