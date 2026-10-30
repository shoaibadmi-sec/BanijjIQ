import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {patchOriginalPosApiCatalog} from '../../scripts/preview/patch-original-pos-api-catalog.mjs';

const read = p => readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('original POS stays pinned: source JSX is unchanged and API preview only rewires its data',()=>{
  const original=read('apps/hisabiq-web/src/pages/Pos.tsx');
  const source=execFileSync('git',['hash-object','apps/hisabiq-web/src/pages/Pos.tsx'],{encoding:'utf8'}).trim();
  assert.equal(source,'d149a698fa49e5bf4a3b263651707dca59f1dee7');
  const patched=patchOriginalPosApiCatalog(original);
  const layout='      <div data-pos-layout';
  assert.ok(original.includes(layout));
  assert.equal(patched.slice(patched.indexOf(layout)),original.slice(original.indexOf(layout)),
    'original CartTable, CheckoutPanel and other POS JSX must remain byte-identical');
  assert.match(patched, /const cart = usePosCart\(\(\) => \[\]\)/, 'no demo cart on API preview');
  assert.match(patched, /const quickItems = previewCatalog\.filter/, 'D1 catalog feeds original quick picks');
  assert.match(patched,/invoice posting is disabled/, 'fail closed until invoice API wiring is ready');
  assert.throws(()=>patchOriginalPosApiCatalog(original+' '),/Unknown original Pos/);

});
test('API preview uses the pinned Pos component and never introduces a replacement POS page',()=>{
  const prep=read('scripts/prepare-hisabiq-react.mjs');
  const provider=read('react-integration/overlay/src/integration/OriginalPosCatalogProvider.tsx');
  const bridge=read('react-integration/overlay/src/bundles/usePreviewCatalog.ts');
  assert.match(prep, /<OriginalPosCatalogProvider><Pos \/><\/OriginalPosCatalogProvider>/);
  assert.match(prep, /patchOriginalPosApiCatalog/);
  assert.match(prep, /<Route path="pos" element={<LivePos \/>} \/>/,'keep posting live POS active until original is fully wired');
  assert.match(provider, /loadOriginalPosCatalog/);
  assert.match(bridge, /useContext\(OriginalPosCatalogContext\)/);
  assert.match(bridge,/sourceProducts/);
});
