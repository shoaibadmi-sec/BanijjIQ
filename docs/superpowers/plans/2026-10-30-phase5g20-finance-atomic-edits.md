# Phase 5G20 — Atomic finance transaction edit/delete rollback and reporting

## Scope and rationale
On merged `main` only, `updateFinanceTransactionRoute` and `deleteFinanceTransactionRoute` call `reverseFinanceMoney` before changing `finance_transactions`, then often call `postFinanceMoney` afterwards. Separate SQL statements and nested batches mean a failed later UPDATE/INSERT leaves the old money book soft-deleted and the bank master adjusted while the source finance header is not updated. This is not acceptable for an ERP. Do not import open Phase 6 Daybook PRs #28/#39, alter the original React UI, or deploy to production.

## Test-first acceptance
Add `tests/reports-finance-edit-delete-atomic.integration.test.ts` using real authenticated Hono API with full local migrations and disposable SQLite, with a POS cash session.
- Create Bank opening BDT300, Owner and Lender. Post Bank Loan Received BDT120: bank BDT420, source and one bank book present, 0 owner equity.
- BEFORE UPDATE trigger on `finance_transactions` raises an injected failure. Try PUT changing to Owner Investment BDT80 Cash. Require failure without **any** changes to bank balance, bank book is_deleted/status, cash book, finance header, audit, or live report.
- Drop trigger and PUT again: bank back BDT300; old bank posting reverses once; source becomes Owner Investment Cash BDT80; owner capital BDT80, loan liability zero; live reports cashReceipts=8000 poisha, bankReceipts=0, bankCurrentBalance=30000, ownerCapitalIn=8000. No excess profit from capital.
- Inject BEFORE UPDATE OF is_deleted trigger on `finance_transactions` for DELETE; reject failed delete without changing archived/current money entries, master, header, audit, or reports. Drop trigger and DELETE with reason; cash posting is reversed, original finance marked deleted, ownerCapitalIn=0, receipt totals zero. Duplicate delete rejected without journal/audit changes.
- Bank-book failure on PUT to new bank also must roll back previously touched original account and Finance header. Check source evidence and report reads never write.
- TDD: commit test and wire into backend mandatory GitHub Actions first; obtain actual RED; perform root cause analysis before minimal Ponytail fix. Do not fabricate RED for test-only characterization.

## Implementation boundary
Implement one `db.batch` per Finance edit/delete transaction covering old cash/bank posting reversal, bank-account balance updates, new finance source metadata, new cash/bank posting, and audit. Validate source row and old payment side where sensible; preserve existing soft-delete journal provenance (do not delete original rows physically). Reuse current validation, finance types and SQL helpers. No schema/React UI changes. Narrow finance report changes only if test proves necessary.

## Completion gate
Run focused new test + full existing finance/accounting business logic tests and exact-head GitHub Actions backend, React, Playwright/axe, local Worker/D1 (14/0). Review changed files. Squash merge only when exact head complete green and required reviews permit. No remote D1 or hosted/prod deployments.
