import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/components/PosPanel.vue', import.meta.url), 'utf8');

test('HisabIQ port uses cart-first POS V2 shell and isolated teal theme', () => {
  for (const marker of [
    'class="gas-pos hisabiq-pos"',
    'class="hi-pos-columns"',
    'class="hi-pos-cart-frame"',
    'class="hi-pos-cart-scroll"',
    'class="hi-pos-checkout"',
    'class="hi-pos-payable"',
    'class="hi-pos-quick-grid"',
    '--hiq-teal:#0d7c74',
    '--hiq-ink:#0b1a2c',
  ]) assert.ok(ui.includes(marker), 'Missing '+marker);
  assert.ok(!ui.includes('class="pos-layout"'), 'Old product catalogue-first layout should be retired');
});

test('POS keyboard product picker and live checkout bindings exist', () => {
  for (const marker of [
    'role="combobox"',
    'role="listbox"',
    'aria-autocomplete="list"',
    '@keydown="onSearchKeydown"',
    '@mousedown.prevent="chooseProduct(p)"',
    'highlightedProductIndex',
    "if(e.key==='F2')",
    "if(e.key==='F8')",
    '@keydown.enter.prevent="focusProductSearch"',
    'v-model.number="sale.amountReceived"',
    'v-model.number="sale.discount"',
    'v-model.number="l.unitPrice"',
  ]) assert.ok(ui.includes(marker), 'Missing '+marker);
});

test('transaction posting, serials, vendor sourcing and invoice output stay connected', () => {
  for (const marker of [
    'async function finishSale()',
    'completeSale(payload)',
    'updateSale(updateInvoiceId.value',
    'getPosProductTrackingOptions(line.productId)',
    'toggleLineSerial(opt.serialNumber)',
    'useOwnStock(l)',
    'useVendor(l)',
    'useNegative(l)',
    'l.vendorId',
    'l.vendorUnitCost',
    'lineShortage(l)>0',
    '@click="finishSale"',
    '@click="printInvoice(',
    '@click="downloadInvoiceJpg"',
    '<InvoicePaper',
    '<SalesInvoiceDetail',
  ]) assert.ok(ui.includes(marker), 'Missing '+marker);
});

test('unsupported installments, bundles, and split payment controls are not presented as live', () => {
  assert.ok(!ui.includes('data-bundle-checkout'), 'No fake bundle checkout controls');
  assert.ok(!ui.includes('data-installment-checkout'), 'No fake installment controls');
  assert.ok(!ui.includes('data-split-payment'), 'No unbacked split-payment control');
});
