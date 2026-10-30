import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {patchOriginalPosCustomerPicker} from '../../scripts/preview/patch-original-pos-customers.mjs';
import {patchOriginalPosApiCatalog} from '../../scripts/preview/patch-original-pos-api-catalog.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const hash=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');

test('original customer picker JSX stays unchanged while customer data is routed to API context',()=>{
  const src=read('apps/hisabiq-web/src/components/pos/CustomerPicker.tsx');
  assert.equal(hash(src),'a2cf1d741d81a2b415d78b1a6d48b3d8a3c9067a');
  const result=patchOriginalPosCustomerPicker(src);
  const anchor='  return (\n    <FloatingPanel';
  assert.ok(src.includes(anchor),'pinned original picker exists');
  assert.equal(result.slice(result.indexOf(anchor)),src.slice(src.indexOf(anchor)));
  assert.match(result,/OriginalPosCustomerContext/);
  assert.ok(!result.includes('getPartyPreviewSnapshot'));
  assert.throws(()=>patchOriginalPosCustomerPicker(src+' '),/Unknown original CustomerPicker/);
});

test('original POS JSX and cart stay unchanged when active customer identity/due use backend',()=>{
  const src=read('apps/hisabiq-web/src/pages/Pos.tsx');
  const result=patchOriginalPosApiCatalog(src);
  const anchor='      <div data-pos-layout';
  assert.equal(result.slice(result.indexOf(anchor)),src.slice(src.indexOf(anchor)));
  assert.match(result,/OriginalPosCustomerContext/);
  assert.match(result,/customerSettlement=activeCustomer\?/);
  assert.match(result,/refundableCredit:0/,'store credit must not be guessed from customer due');
});
