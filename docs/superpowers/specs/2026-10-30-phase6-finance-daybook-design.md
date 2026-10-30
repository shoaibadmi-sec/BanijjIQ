# Phase 6 — Finance, Cash/Bank & Daybook (design proposal)
Date: 2026-10-30
Status: APPROVED by user 2026-10-30; Phase 6A implementation in progress; not approved for release
Repository: shoaibadmi-sec/BanijjIQ
Branch: feat/hisabiq-phase6-finance-daybook

## Why this is next
Phases 3 (sales, refunds, store credit), 4 (purchase, FIFO, supplier), and 5 (two-tab Reports) are separate parallel workstreams. Phase 6 should close the operational cash/bank/finance/Daybook gap, **not** recreate those modules or alter their accounting posting contracts. No historical roadmap conclusively assigned a new Phase 6 for the current React migration, so this is a **recommendation for approval**, not a claim of prior approval.

## Repository baseline inspected
- Existing Hono/SQLite/D1 services: `server/modules/finance/{routes,service,types}.ts`, `server/modules/expenses/*`.
- Existing bank endpoints: accounts, ledgers, manual entries, transfers, reversals.
- Existing finance endpoints: persons, owner/lender transactions, balance bootstrap and person ledger.
- Existing source UI: `src/components/{BankPanel,FinancePanel,DayBookPanel}.vue`; the old Vue UI is reference material only, not a target for new frontend work.
- Existing React integration: `react-integration/overlay/src/integration` and authenticated `banijjApi.ts`; Phase 6 must use the existing React UI/UX with the approved HisabIQ design system and Mohim-style Finance workflows, no Vue/React mixing.
- POS already has `/api/pos/cash-session/start`. Phase 5 reporting reads `cash_book`, `bank_book`, `finance_transactions`, `expenses`; do not edit Phase 5 Reports navigation. Business Audit remains deferred.

## Goals
1. A single trustworthy daily-accounting experience: Finance, Cash & Bank, Finance Person Ledger, Expenses and Daybook.
2. Show balances backed by source transactions and explicit reconciliation states. Never present unverifiable balances as certified.
3. Preserve existing HisabIQ compact blue brand, 36px controls, 48px primary actions, bilingual Bangla helper labels, responsive 390/768/1440 layouts, keyboard navigation, underlined section tabs and clean action menus.
4. Support source-linked drill-through and immutable correction/reversal evidence; keep data and UI comprehensible for Bangladeshi low-literacy shop operators.
5. Safe GitHub-only delivery through isolated, additive D1 migrations and independent PR/CI without merging/deploying until acceptance.

## Alternatives and decision for approval
- Rebuild Finance/Daybook from scratch: rejected (existing Hono business logic, Vue UX and D1 tables already cover much of the domain).
- Expand Phase 5 Reports into transactional Finance: rejected (breaks approved two-tab read-only Reports boundary).
- **Recommended:** reuse existing services, add the minimum missing server invariants and build native React adapters/views; source-linked Daybook is an aggregation/view, not a second posting system.

## Scope and acceptance slices
### 6A — source-backed Finance foundation
Build authenticated, read-only React Finance view and contract adapters using current endpoints. Reconcile displayed cash/bank/owner/loan values against existing ledgers. Flag mismatch or missing provenance as `needs-review`; no fabricated snapshot or write side effects on GET.

### 6B — Cash, bank & mobile-money transactions
Reuse bank account CRUD, manual entries, bank ledger, bank transfers and reversals. Cover Cash ↔ Bank, Bank ↔ Bank and Mobile Banking as account types only where current models support them. Add retry-safe idempotency/atomic guards only when real test gaps demand them. Outgoing and incoming legs must agree; never count a transfer as sales/profit.

### 6C — Cash sessions
Use existing POS session lifecycle. Opening float is physical custody, not income; cash counted at closing and expected cash must be shown separately. Non-zero variance needs reason/authorization, retained evidence, and no silent cash balance rewrite. Session creation/closing and retry behavior must be atomic.

### 6D — Finance Person Ledger
Owner capital/investment, withdrawal, lender borrowing, repayment and independent owner/lender ledger. Do not merge person finance balances into customer receivables or supplier payables. Existing `finance_persons`/`finance_transactions` are source of truth, with historical ledger and original-account reversals.

### 6E — Unified Daybook
Read-only source-backed unified transaction history covering Sales, Returns, Purchases, Supplier payments, Expenses, Bank, Finance and corrections only after their upstream posting is ready. Show transaction date vs created date, user, source reference/status, filter/search/calendar, 50/100 rows and bounded server pagination with deterministic tie-breaks, and printable selected rows. Entry opens its real original record; actions dispatch through the original authorized module, never generic Daybook rewrites.

### 6F — Expenses & reconciliation
Reuse expense categories, payees, entries, cancellation and existing cash/bank postings. Reconcile expenses to their cash/bank source movements and expose anomalies. Bank reconciliation should distinguish statement evidence from internal book balance; do not claim bank-statement matching until actual statement lines exist.

### 6G — TDD/CI/release evidence
Pure function tests, real isolated SQLite/D1 migrations, Worker/Hono APIs, race/idempotency and forced-rollback assertions, source-link authorization, responsive Playwright + axe, accessibility and print; confirm exact HEAD CI before considering a release.

## Accounting invariants and safeguards
- Source postings (Phase 3 sale/refund/store credit and Phase 4 purchasing/supplier settlement) remain owned by their phase. Phase 6 **consumes and reconciles** their posted entries; cross-phase defects get a documented handoff, not an opportunistic change.
- Use transaction IDs and client-generated idempotency keys for new write pathways; same key/same payload is a harmless replay, same key/changed payload is rejected. Prevent overdrawing as current business rules require; use one D1 transaction/batch or prove rollback.
- Financial precision must follow the validated existing storage contract; do not silently convert historic four-decimal rows to whole poisha. Reconcile any cross-contract fractional cases explicitly and withhold affected totals when unresolved.
- Keep original dates, timestamps, account IDs, line references, author, reversal reason and audit evidence. Cancel/reverse using compensating entries, not hard deletion.
- Tenant isolation, RBAC and negative-path authorization are mandatory. GET/search/print/export must not mutate data.
- Ensure opening balances are not counted twice, cash session opening float is not sales, internal transfers net to zero between affected accounts, and finance loan principal isn't revenue.
- Every source-backed balance shows date/scope; unknown historic opening evidence is reported as incomplete.
- New migration numbers must be assigned after verifying all merged and pending Phase 4/5 migrations; never collide with Phase 4's planned `0050`–`0053` and never apply to hosted/production D1 in development.

## Integration ownership and no-conflict rules
- Phase 3 owns POS, Sales Returns, Store Credit and tender postings.
- Phase 4 owns Purchases, supplier settlements, FIFO and supplier ledgers.
- Phase 5 owns the Reports Dashboard and Report Library, no standalone Advisor tab, and Business Audit remains deferred.
- Phase 6 owns Finance/Cash/Bank/Expenses/Daybook React views and the smallest service changes needed for verified financial invariants.
- Branch from current `main`; PR stays draft. Rebase only with explicit review of touching migrations/contracts. Never auto-merge or auto-deploy.

## Delivery gate
This document was **approved for implementation on 2026-10-30**. Actual implementation and test status must be verified from the Phase 6 draft PR and its exact-commit GitHub Actions runs. Subsequent implementation must use Superpowers RED→GREEN→REFACTOR and Ponytail minimal code reuse, with exact-head CI and accounting review before release.
