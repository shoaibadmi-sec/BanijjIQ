import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const originalPath = 'apps/hisabiq-web/src/components/pos/CheckoutPanel.tsx';
const componentPath = 'react-integration/overlay/src/integration/LiveCheckoutPanel.tsx';
const posPath = 'react-integration/overlay/src/integration/LivePosPage.tsx';
const original = readFileSync(originalPath, 'utf8');
const checkout = readFileSync(componentPath, 'utf8');
const live = readFileSync(posPath, 'utf8');

test('CheckoutPanel reference remains original pinned HisabIQ blob', () => {
  assert.equal(execFileSync('git', ['hash-object', originalPath], { encoding: 'utf8' }).trim(),
    '3c327fbccd6ef633f0bba57c503097749d662aeb');
  for (const marker of ['data-pos-checkout', 'data-pos-payable',
    'data-testid="pos-invoice-details-toggle"', 'data-pos-customer-fields',
    'AmountInWordsDisplay', 'data-erp-workflow-action="complete"']) {
    assert.ok(original.includes(marker), 'Original checkout lost marker ' + marker);
    assert.ok(checkout.includes(marker), 'Integrated checkout lost marker ' + marker);
  }
});

test('checkout is driven by live D1 data and disallows fixture-backed payments', () => {
  assert.ok(live.includes('<LiveCheckoutPanel'));
  assert.ok(live.includes('postSale(payload)'));
  assert.ok(checkout.includes('customers: PosBootstrap'));
  assert.ok(checkout.includes('onReview: () => void'));
  assert.ok(checkout.includes('props.errors.length > 0'));
  assert.ok(checkout.includes('props.requiresAccount'));
  assert.ok(!checkout.includes('partyPreviewStore'));
  assert.ok(!checkout.includes('usePosCart'));
  assert.ok(!checkout.includes('makePosPaymentRow('));
  assert.ok(!checkout.includes('Customer Credit'));
  assert.ok(!checkout.includes('InstallmentTermsPanel'));
});

test('discount percent maps to backend fixed amount and no unsupported change is issued', () => {
  assert.match(live, /Math\.round\(subtotal \* rawDiscount\) \/ 100/);
  assert.match(live, /discount: discountAmount, paymentType/);
  assert.match(live, /paidAmount > total/);
  assert.ok(checkout.includes("props.onPaid(String(props.total))"));
  assert.ok(!checkout.includes('changeToReturn'));
});
