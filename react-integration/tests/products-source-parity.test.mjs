import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const baselineUrl = new URL('./reference/products-baseline.json', import.meta.url);
const sourceUrl = new URL('../../apps/hisabiq-web/src/pages/Products.tsx', import.meta.url);
const sourceRepo = fileURLToPath(new URL('../../apps/hisabiq-web/', import.meta.url));
const PINNED_HISABIQ_COMMIT = '0389b179b6fa8e930f64d014c90d1a8785c00664';
const PINNED_HISABIQ_BLOB = 'ffd429f0b65eaee8146ed7089cb9412a78f0e975';
const PINNED_MOHIM_COMMIT = 'f95be8d9bcf55b08abe8841e7502d27b23c82c4c';
const PINNED_MOHIM_BLOB = 'b3c8fb5ba179f5eb7951dd9c66dcfb2fa0a37303';
const requiredMarkers = ['pageHeader', 'underlineTabs', 'columnPicker', 'stockValueHead', 'rowActions', 'search', 'addForm', 'rowDensity'];

const readBaseline = () => {
  assert.ok(existsSync(baselineUrl), 'Missing frozen Products baseline manifest');
  return JSON.parse(readFileSync(baselineUrl, 'utf8'));
};

test('source revision and protected Products JSX markers match the reference manifest', () => {
  const baseline = readBaseline();
  const products = baseline.hisabiq;
  assert.equal(products.path, 'src/pages/Products.tsx');
  assert.equal(products.commit, PINNED_HISABIQ_COMMIT);
  assert.equal(products.blobSha, PINNED_HISABIQ_BLOB);
  assert.ok(existsSync(sourceUrl), 'Pinned HisabIQ Products.tsx submodule was not checked out');

  const actualCommit = execFileSync('git', ['-C', sourceRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const actualBlob = execFileSync('git', ['hash-object', fileURLToPath(sourceUrl)], { encoding: 'utf8' }).trim();
  assert.equal(actualCommit, products.commit, 'Do not silently advance the UI source submodule');
  assert.equal(actualBlob, products.blobSha, 'Do not modify the original Products source');

  const sourceLines = new Set(readFileSync(sourceUrl, 'utf8').split(/\r?\n/));
  assert.deepEqual(Object.keys(products.markers).sort(), [...requiredMarkers].sort());
  for (const [name, marker] of Object.entries(products.markers)) {
    assert.equal(typeof marker.line, 'string', name);
    assert.ok(sourceLines.has(marker.line), `Original Products ${name} JSX changed`);
    assert.equal(createHash('sha256').update(marker.line).digest('hex'), marker.sha256, `Invalid ${name} marker hash`);
  }
});

test('Mohim reference and visual review checklist preserve the agreed product workflows', () => {
  const baseline = readBaseline();
  assert.equal(baseline.mohim.path, 'products.html');
  assert.equal(baseline.mohim.commit, PINNED_MOHIM_COMMIT);
  assert.equal(baseline.mohim.blobSha, PINNED_MOHIM_BLOB);
  assert.deepEqual(baseline.mohim.actions.map(action => action.label), [
    'Edit', 'Adjust Stock', 'View Lots', 'Activate / Deactivate', 'Delete'
  ]);
  assert.deepEqual(baseline.mohim.formEntrySelectors, [
    'prodName', 'prodType', 'prodBrand', 'prodCategory', 'prodUnit',
    'prodPurchasePrice', 'prodSellingPrice', 'prodStock', 'prodMinStock', 'prodBarcode'
  ]);
  assert.deepEqual(baseline.visualReview.viewports, [390, 768, 1024, 1440]);
  assert.deepEqual(baseline.visualReview.themes, ['light', 'dark']);
  for (const check of ['underline tabs', 'compact row density', 'stock value', 'search and filters',
    'column picker', 'row More/actions', 'Add Product entry', 'Bangla helper text',
    'keyboard focus', 'no horizontal page overflow']) {
    assert.ok(baseline.visualReview.checklist.includes(check), `Missing visual review: ${check}`);
  }
  assert.equal(baseline.visualReview.dataPolicy, 'layout-only: exclude fixture values');
  assert.equal(baseline.visualReview.routeSwitchDeferredUntilTask, 6);
});
