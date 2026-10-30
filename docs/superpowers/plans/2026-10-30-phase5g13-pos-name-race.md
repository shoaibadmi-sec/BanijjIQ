# Phase 5G13: POS second-sale customer input race — TDD

## Evidence and diagnosis
- [Issue #35](https://github.com/shoaibadmi-sec/BanijjIQ/issues/35): real Worker/D1 browser run #41042719694 lost only customer name after New Sale; phone and received amount remained; sale reset version remained constant. This also blocked the second invoice and stock reconciliation. Exact-head retry passed, so the symptom is intermittent.
- LivePosPage only clears customer name in `resetSaleState` (which increments reset version), in name input `onChange`, and when selecting a saved customer. `selectCustomer` refuses empty customer records (PR #37). With unchanged reset version, the unguarded input event path is a candidate, not a proven root cause.
- **Ruling:** Model a late empty DOM input event received after the name field loses focus. Explicit user clearing while focused must still work. Run the real-browser case before deciding whether a production guard is warranted.

## Test → fix → evidence
1. On separate GitHub-only branch, add a browser regression on the existing genuine local Worker/D1 second-sale flow: enter second-sale customer name/phone, move focus to amount, dispatch a late empty `input` event using the native setter on the now-blurred name field, trigger another React render and assert no loss. Verify that user-driven focused emptying is still allowed and refilling succeeds. Maintain the original final D1 invoice/stock check.
2. Run required workflow and capture expected RED on added assertion. If the synthetic event doesn't reproduce the defect, avoid speculative production fixes; instrument state flow and leave issue open.
3. If RED reproduces, apply minimum scope guard to `LiveCheckoutPanel` name onChange; do not change original pinned React submodule, POS design, cash/ledger posting or other handlers.
4. Re-run exact-head backend/React Playwright/axe and isolated local Worker/D1. Require full GREEN before merge. Hosted/prod remain HOLD. Do not close Issue #35 based on one green run; native intermittent reproducer required.
