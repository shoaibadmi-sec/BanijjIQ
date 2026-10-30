# Phase 3 — Sales & Returns accounting acceptance matrix

**Scope:** HisabIQ React POS + BanijjIQ Hono/Cloudflare D1, with original HisabIQ UI unchanged.
**Branch:** `test/hisabiq-phase3-full-accounting-matrix` stacked on Phase 3G2-H PR #42 and #33 → #31 → #26 → #20 → #19 → #18.
**Method:** TDD **RED → GREEN → REFACTOR**, Ponytail: existing service/constraints/fixtures, no second posting engine.
**Status:** *tests and implementation in progress*. Exact-head green CI is **not** production/hosted-preview signoff.

## Required accounting matrix

| Area | Contract to prove (positive + negative) | Existing executable coverage / new gate |
| --- | --- | --- |
| 3A POS posting | One invoice, immutable stock/book references and actor/audit; invalid input and audit fault roll back without ghost invoice | `tests/pos-accounting.integration.test.ts`, `d1-checks/run.mjs`, `d1-checks/phase13-browser.mjs` |
| 3B mixed-unit sale | Joined CT/BOX/PCS conversions, snapshot revision, exact base quantity and FIFO, rejected invalid/stale profile, no duplicate stock consumption | `tests/pos-unit-profile.integration.test.ts`, `tests/pos-mixed-sale.integration.test.ts`, `ui-checks/run.mjs` |
| 3C Sales Return | Original invoice + eligible quantities, partial/mixed-unit historical price and FIFO restore; over-return, duplicate, tracked serial and invalid serial rejected | `tests/pos-mixed-return.integration.test.ts`, `ui-checks/run.mjs`, `d1-checks/phase13-browser.mjs` |
| 3D–E reversal | Original invoice survives reversal with audit trail; full/partial-history eligibility, original lot/denomination restored exactly once | `tests/pos-mixed-reversal.integration.test.ts`, `d1-checks/phase12.mjs` |
| 3F cash/bank/mobile | Reverse to **original** account and session, no substituting Cash, no second payout; inactive/mismatched bank and reconciliation drift fail closed | `tests/pos-bank-reversal.integration.test.ts`, `d1-checks/historical-credit.mjs` |
| 3G1 due reversal | Fully unpaid invoice reverses receivable **without** cash/bank refund; shared customer ledger, drift, paid/due mixture fail closed | `tests/pos-due-reversal.integration.test.ts`, `ui-checks/run.mjs` |
| 3G2-A–B credit issuance | Credit as **liability** not negative due; one verified issuance per return; sale/stock/audit/liability atomic, no fake cash/bank posting | `tests/store-credit-liability.integration.test.ts`, `tests/store-credit-issuance.integration.test.ts` |
| 3G2-C redemption | Correct customer/account ownership; integer poisha, balance never negative, idempotent request replay, concurrent redemption safe; no cash receipt | `tests/store-credit-redemption.integration.test.ts` |
| 3G2 historical remediation | Legacy unjournaled credit is disclosed/blocked, not silently fabricated; resolution needs original evidence and audit, fail closed on conflict | `tests/store-credit-reconciliation.integration.test.ts`, `tests/store-credit-cases.integration.test.ts`, `tests/store-credit-case-resolution.integration.test.ts`, `tests/store-credit-historical-compensation.integration.test.ts`, `tests/store-credit-outstanding-impact.integration.test.ts` |
| 3G2-G split tender | Immutable Cash/Bank/Mobile/Credit allocations equal the discounted invoice in **integer poisha**; original receipts and journals reconcile; replay/changed-key reissue blocked | `tests/split-sale-tenders.integration.test.ts`, `d1-checks/historical-credit.mjs`, `ui-checks/run.mjs` |
| 3G2-H split full refund | Source-exact Cash/Bank/Mobile payout + **Store Credit reissue** (liability only), original FIFO restoration and journal/audit in one batch; double refund, injected audit failure and silent FIFO update blocked | `tests/split-sale-tenders.integration.test.ts`, `tests/phase3-split-refund-permissions.integration.test.ts`, `ui-checks/run.mjs` |
| 3G2-H preflight/POST parity | The review UI **must not** mark unsupported discount, tampered historical line prices or mixed denominations eligible when POST would reject; no source mutations for previews | New RED→GREEN assertions in `tests/split-sale-tenders.integration.test.ts` (this PR) |
| Authorization | Read-only and posting permissions separately; returns-only cashier allowed to use return/refund, sales-only user cannot refund | `tests/phase3-split-refund-permissions.integration.test.ts`; `server/modules/auth/permissions.ts` |
| React/UI/accessibility | Original compact HisabIQ POS; correct checkout/returns call sequence and confirmation, 390/768/1440 screenshots, WCAG axe, no sample data or duplicate POSTs | `ui-checks/run.mjs`, `react-integration/tests/phase3-split-refund-return-contract.test.mjs`, existing POS source parity contracts |
| Real Cloudflare runtime | Migrated disposable Worker/D1; invoice, cash/bank, credit, stock/FIFO and audit post/reverse once; no production D1 changes | `d1-checks/run.mjs`, `d1-checks/historical-credit.mjs`, `d1-checks/phase12.mjs`, `d1-checks/phase13-browser.mjs` |

## Release-critical new assertions

1. **Preview/Post parity**: verified source preview must agree with POST's supported-transaction scope. A discounted or repriced original sale must report `eligible:false` before the user confirms. Same for mixed-unit source snapshots; separate route tests required.
2. **Financial conservation**: for each posted and reversed invoice, original source receipts + credits must equal the immutable tender journal; return refunds must equal original source allocations, FIFO restored **once**, A/R unchanged for credit-only movement, and no Cash/Bank fabricated for Store Credit.
3. **Atomic rollback**: inject failures at audit insert, FIFO lot restore, source debit, and credit ISSUE. No partial state in sale/return, stock, bank/cash, ledger, audit, allocation or liability tables.
4. **Idempotency and concurrency**: exact replay returns original invoice, changed amount/account must conflict; refund a single invoice only once; concurrent credits cannot overspend.
5. **Role/tenant boundary**: GET and POST permission matrices under real auth. No cross-tenant/source-ID substitution or lack of login bypass.
6. **Browser proof**: verify source account and liability amounts on 390px phone, 768px tablet, 1440px desktop before posting; double-click cannot double post; unknown network result disables blind retry.

## CI execution gate

Existing [`.github/workflows/hisabiq-react-build.yml`](../../.github/workflows/hisabiq-react-build.yml) runs the mapped source contract, backend migration/SQLite tests, pinned React build, browser/axe, and isolated Worker/D1 scripts. Add new tests to that job explicitly; keep all previously mapped tests active. A **single** failing test blocks merging. Store logs/screenshot/axe/SQLite artifacts. Never mark skipped hosted-preview jobs as passed.

## Explicitly NOT accepted / remains disabled

- **Partial split-payment refunds** with proportional source allocation; require a separate immutable rounding/reversal design, new SQLite/D1 financial tests, no cash substitution.
- **Multi-invoice batch returns** and mixed-unit **split-tender** refunds; current source provenance is insufficient for safe activation.
- Historical legacy Store Credit with unreconciled liability or customer receivable: don't auto-seed, rewrite or silently reverse.
- Discounted, tracked serial/warranty/expiry, vendor-sourced, negative-stock and historically edited split-invoice refunds where source reconstitution isn't proven.
- Hosted visual/a11y review, human accounting/security approval, production schema/data migration and production release until the stacked parents are accepted.

**Completion definition:** exact commit SHA + all required GitHub Actions green, source-level financial reconciliation, no critical missing feature silently enabled, explicit hosted and accounting acceptance. An isolated GitHub CI success is only engineering verification, *not Phase 3 production completion*.
