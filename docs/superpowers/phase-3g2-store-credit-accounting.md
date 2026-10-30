# Phase 3G2 — Customer Store Credit liability accounting

Status: implementation specification only. **Do not enable Store Credit in the live React UI or mark Phase 3G2 complete until code, database tests, CI, and hosted-preview acceptance pass.**

## Dependency and existing defect

- Repository: `shoaibadmi-sec/BanijjIQ`.
- Parent branch: `feat/hisabiq-due-reversal-phase3g` (PR #19, Phase 3G1), stacked on `feat/hisabiq-bank-mobile-full-reversal-phase3f` (PR #18).
- Existing `completeSalesReturnRoute` accepts `refund_method='Store Credit'`, but currently subtracts the credit from `customers.current_due` and records `Sales Return Credit` in `customer_ledger`. This incorrectly treats a liability as a negative receivable. The React Returns screen deliberately disables Store Credit. Do not re-enable the old path without replacing its accounting.
- Existing full-reversal planner blocks historical Store Credit returns. Preserve this **fail-closed** behavior until their outstanding liabilities and past redemptions can be reconciled.

## Accounting contract

1. **Different balances:** `customers.current_due` and `customer_ledger` represent customer receivables. A separate, append-only Store Credit liability journal represents amounts **owed by the business to customers**. Never infer credit balance from negative due.
2. **Integer cents:** Store Credit journal entries and materialized available balance use nonnegative integer minor units; journal delta is signed. Enforce `ending = previous + delta` atomically and prevent a negative available balance. Include immutable customer, invoice, return, source and actor identifiers.
3. **Issue once:** One `Store Credit` sales-return ID may issue at most one corresponding liability. Issuance must be committed in the same D1 batch as sales-return items, FIFO stock restoration and audit event. No customer receivable debit/credit, cash-book entry or bank-book entry is generated solely for issuance.
4. **Only verified value:** For the first safe implementation, issue a credit only against a linked, active customer and a fully paid, reconciled original sale with no outstanding due. The sum of prior cash/bank refunds and outstanding/used Store Credit issued against that sale, plus the new credit, cannot exceed the original verified paid amount. Reject partially paid and unpaid scenarios rather than inventing refundable funds.
5. **Redeem once:** Credit redemption toward an actual sale has unique idempotency/source keys, valid customer ownership, sufficient available balance, and an atomic liability decrease plus sale settlement record. Using Store Credit is not a cash/bank deposit. Do not post a fake cash payment. Do not allow overdrafts or replay to spend credit twice.
6. **Snapshot and audit:** Preserve original invoice, original quantity denominations, FIFO lots, return adjustments, immutable journal entries, and actor/time/reason on each issue and redemption. Never delete credit events to reverse their effects; append compensating entries under a separate, audited operation only where a verified correction is authorized.
7. **Historical Store Credit:** Add read-only discovery/reconciliation for pre-3G2 `sales_returns.refund_method='Store Credit'` that lack a matching liability journal. Do **not** silently seed balances, overwrite `current_due`, replay issuance, or assume whether a legacy credit was spent. Exclude affected customers/invoices from new issue/redemption and full reversal until an explicit audited migration/reconciliation is approved.
8. **Isolation:** Customer identity, authorization and the relevant D1 database boundary must be checked at every mutation. Request replay and concurrent requests must preserve exact balance/journal invariants.

## Planned delivery order

- G2-A: Add D1 liability account/journal migration and read-only outstanding/legacy reconciliation queries. Add database constraints and tests.
- G2-B: Refactor the existing Store Credit return path to post audited issuance atomically, with no change to receivables or money books. Prevent legacy negative-due accounting. Tests must cover partial return, multiple invoices, mixed units and rollback.
- G2-C: Add guarded Store Credit redemption and POS payment allocation where payment models support it; reject unsupported multi-source/partially settled combinations until fully reconciled. Include tests for overdraw, replay, concurrent batches and original invoice settlement.
- G2-D: Enable concise bilingual Store Credit UI only after server functionality is verified; show Due and Credit **separately**, clear issuance/redemption confirmation, available balance and history.
- G2-E: Run full migration SQLite accounting regressions, React TypeScript/build, Worker/D1, Playwright, screenshots, axe, hosted preview and manual accounting acceptance. Release stays blocked until all gates are satisfied.

## Required negative tests

- Unpaid sale cannot produce spendable Store Credit.
- A return cannot increase both Store Credit liability and a customer's receivable credit.
- A Store Credit issue/redeem cannot move cash or bank balances by itself.
- Duplicated return ID, duplicated checkout request, or simultaneous redemptions cannot double issue/spend.
- Credited amount cannot exceed verified original paid/refundable funds.
- Existing unjournaled Store Credit or mismatched historical `current_due` cannot be silently converted.
- Error in any statement rolls back the entire return/credit/stock/audit transaction.
- Previously reversed or returned quantity cannot be returned again.
- Customer identity mismatch, missing/disabled customer, stale balance or missing account causes a conflict, with no side effects.

## PR and merge policy

Keep #18 -> #19 -> this phase in dependency order. Each PR starts draft, retains its real CI artifacts and is not described as completed until green tests, hosted-preview review and accounting evidence exist. Stop on failed CI, unreconciled history, missing visual review, conflicts or deployment migration uncertainty. No automatic production D1 migration or production deployment. After acceptance, merge each dependency in order and retarget the next PR to main.
