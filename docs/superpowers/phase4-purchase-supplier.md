# HisabIQ Phase 4 — Purchases & Supplier completion

Status: **in progress on draft-only branch**, not released, no hosted or production migration.

Source of truth: verified `shuvodelux-commits/Mohim_ERP` business behavior, original pinned HisabIQ React UI; Hono/D1 is the only accounting write authority. No design rewrite, no demo rows, no local or remote production D1 use.

## Sequential acceptance gates

- [x] **4A backend foundation**: read-only, purchase-authorized supplier lookup with case-insensitive name/phone/ID matching, live payable, separate ledger reconciliation flag; purchase payable ledger no longer double-counts the same supplier due in its displayed balance.
- [ ] **4A React entry completion**: original HisabIQ component styling, keyboard supplier selector, live due, saved supplier-only purchase, no fake/demo operational state; offline/ambiguous result handling.
- [ ] **4B**: versioned 2–4 unit purchase quantities and unit-cost normalization to exact base units; reject stale profiles/overflows, atomic FIFO lot/master-stock movements.
- [ ] **4C**: purchase return original-lot cost, exact mixed-unit allocation, tracked serial/expiry eligibility, signed ledger and audit reversal, no double-return.
- [ ] **4D**: supplier payments and due settlement must atomically post ledger + cash/bank entries, prevent overpayment/negative payable, preserve historical reversal audit and original account.
- [ ] **4E**: purchase planner → approved order → converted purchase, immutable source reference, no duplicate conversion and consistent stock/due.
- [ ] **4F**: full migration + isolated Wrangler D1, mocked and real-browser Playwright, a11y/keyboard/screenshots, reconciliation and independent finance review.

## Release holds

Current `main` has already merged earlier React/POS tasks; stacked Phase 3 PRs #18 → #19 → #20 remain separate draft work. Do not bring their unmerged migrations into this branch. Run integration on disposable local DB only. **Do not merge, turn on auto-merge, dispatch hosted deployment, run remote migrations, or promote production Workers** until hosted preview and independent accounting acceptance.
