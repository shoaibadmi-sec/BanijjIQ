import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const upstream='apps/hisabiq-web/src/components/pos/CartTable.tsx';
const adapted='react-integration/overlay/src/integration/LivePosPage.tsx';
const expectedOriginalCommit='9a8dc1ac4e85ac4e60f254e068bd67c2a805673f';
const expectedOriginalBlob='8c0dc4a1447bb7bca003d8ebab9d06e89adf59bb';
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

test('integrated POS preserves original HisabIQ cart column hierarchy and inline add-product row',()=>{
 for(const marker of [originalGrid,'data-cart-kind="sale"','data-cart-header',
   'data-testid="pos-cart"','data-testid="pos-cart-row"','data-cart-row="sale"',
   'data-testid="pos-add-row"','data-cart-add']){
   assert.ok(original.includes(marker),'Original POS missing source marker '+marker);
   assert.ok(live.includes(marker),'Live POS lost original source marker '+marker);
 }
 assert.ok(live.includes('data-live-pos'),'Real POS root must remain integrated');
 assert.ok(live.includes('ProductCombobox ref={productRef}'),'Native product picker must stay in original row');
 assert.ok(live.includes('getPosBootstrap()')&&live.includes('postSale(payload)'),
   'Do not replace real Worker/D1 inventory and invoice posting with demo stores');
 for(const forbidden of ['from \u0027../data/products\u0027','from \u0027../data/sales\u0027']){
   assert.ok(!live.includes(forbidden),'Live cart must not load source demo business data');
 }
});

test('source-matched quantity and unit-price controls remain enabled only for verified single-unit data',()=>{
 assert.ok(live.includes("aria-label={'Quantity for '+line.product.name}"));
 assert.ok(live.includes("aria-label={'Price for '+line.product.name}"));
 assert.ok(live.includes("onClick={()=>setShortageId(line.product.id)}"));
 assert.ok(live.includes("onClick={()=>void openSerialPicker(line.product.id)}"));
 assert.ok(live.includes("if (!supported(line.product))"));
});
