import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchSourceCartForLive,patchJoinedUnitSymbolsForLive} from '../../scripts/preview/patch-source-cart-live.mjs';

const src=readFileSync('apps/hisabiq-web/src/components/pos/CartTable.tsx','utf8');
test('RED→GREEN: original source cart accepts live API catalog instead of demo catalog, preserves identical markup',()=>{
 const patched=patchSourceCartForLive(src);
 assert.match(patched,/liveCatalog\?:Product\[\]/);
 assert.match(patched,/const catalog=liveCatalog\?\?previewCatalog/);
 assert.match(patched,/products=\{catalog\}/);
 assert.match(patched,/data-cart-kind="sale"/);
 assert.match(patched,/data-testid="pos-cart-row"/);
 assert.match(patched,/liveCatalog\?Math\.max\(0,baseQty-l\.product\.stock\)/);
 assert.match(patched,/onLiveSerial\?onLiveSerial\(l\.product\.id\)/);
 assert.match(patched,/onLiveShortage\?onLiveShortage\(l\.product\.id\)/);
 assert.throws(()=>patchSourceCartForLive(src.replace('const catalog=usePreviewCatalog();','')),/CartTable upstream contract changed/);
});
test('RED→GREEN: real POS imports source cart and keeps original source route in place',()=>{
 const live=readFileSync('react-integration/overlay/src/integration/LivePosPage.tsx','utf8');
 const preparation=readFileSync('scripts/prepare-hisabiq-react.mjs','utf8');
 assert.match(live,/import \{ CartTable \} from '\.\.\/components\/pos\/CartTable'/);
 assert.match(live,/<CartTable\s/);
 assert.match(live,/liveCatalog=\{selectable\}/);
 assert.doesNotMatch(live,/data-cart-header/);
 assert.match(preparation,/patchSourceCartForLive/);
});

test('source joined 2–4-unit quantity controls show symbols from live D1 unit settings',()=>{
 const input=readFileSync('apps/hisabiq-web/src/components/transactions/MultiUnitQuantityInput.tsx','utf8');
 const patched=patchJoinedUnitSymbolsForLive(input);
 assert.match(patched,/symbols\?:Record<string,string>/);
 assert.match(patched,/symbols\?\.\[unit\]\?\?unitSymbol\(unit\)/);
 assert.match(patchSourceCartForLive(src),/symbols=\{liveSymbols\?\.\[l\.product\.id\]\}/);
});
