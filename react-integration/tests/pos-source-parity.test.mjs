import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const upstream='apps/hisabiq-web/src/components/pos/CartTable.tsx';
const adapted='react-integration/overlay/src/integration/LivePosPage.tsx';
const expectedOriginalCommit='0389b179b6fa8e930f64d014c90d1a8785c00664';
const expectedOriginalBlob='d60b9776a807b393ad5a730d76dd63e638ac116e';
const originalGrid='grid-cols-[36px_minmax(130px,1fr)_160px_88px_168px_112px_28px]';
const original=readFileSync(upstream,'utf8');
const live=readFileSync(adapted,'utf8');

test('POS reference is the unchanged pinned original HisabIQ source',()=>{
 const commit=execFileSync('git',['-C','apps/hisabiq-web','rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const blob=execFileSync('git',['hash-object',upstream],{encoding:'utf8'}).trim();
 assert.equal(commit,expectedOriginalCommit);
 assert.equal(blob,expectedOriginalBlob);
 assert.ok(original.includes(originalGrid),'Pinned HisabIQ POS must retain original seven-column grid');
});

test('live POS renders original HisabIQ CartTable with real products, preserving source JSX and keyboard cart markup',async()=>{
 const {patchSourceCartForLive}=await import('../../scripts/preview/patch-source-cart-live.mjs');
 const generatedCart=patchSourceCartForLive(original);
 for(const marker of [originalGrid,'data-cart-kind="sale"','data-cart-header',
  'data-testid="pos-cart"','data-testid="pos-cart-row"','data-cart-row="sale"',
  'data-testid="pos-add-row"','data-cart-add']){
  assert.ok(original.includes(marker),'Original POS missing source marker '+marker);
  assert.ok(generatedCart.includes(marker),'Patched original POS lost marker '+marker);
 }
 assert.ok(live.includes('data-live-pos'));
 assert.ok(live.includes('<CartTable lines={sourceLines}'));
 assert.ok(live.includes('liveCatalog={selectable}'));
 assert.ok(live.includes('getPosBootstrap()')&&live.includes('postSale(payload)'));
 assert.ok(!live.includes('data-cart-header'),'No custom duplicate POS cart markup in live UI');
 for(const forbidden of ["from '../data/products'", "from '../data/sales'"])
   assert.ok(!live.includes(forbidden),'Live POS must not import source demo business data');
});

test('real POS tracks server-based quantities, serials and shortages while preserving source inputs',async()=>{
 const {patchSourceCartForLive}=await import('../../scripts/preview/patch-source-cart-live.mjs');
 const patched=patchSourceCartForLive(original);
 assert.ok(patched.includes('onLiveSerial?onLiveSerial(l.product.id)'));
 assert.ok(patched.includes('onLiveShortage?onLiveShortage(l.product.id)'));
 assert.ok(patched.includes('data-pos-price-field'));
 assert.ok(patched.includes('disabled={Boolean(liveCatalog&&l.unitQuantities)}'));
 assert.ok(live.includes('onLiveSerial={id=>{void openSerialPicker(id);}'));
 assert.ok(live.includes('onLiveShortage={setShortageId}'));
 assert.ok(live.includes('if (!supported(line.product))'));
});
