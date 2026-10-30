# Superpowers implementation plan — Phase 6 Finance, Cash/Bank & Daybook
Date: 2026-10-30
Status: PROPOSED PLAN ONLY (requires design approval); do not treat as implementation
Design: `docs/superpowers/specs/2026-10-30-phase6-finance-daybook-design.md`

## Development method
Use the current repository and code paths. Every code slice is RED (test fails for expected missing behavior) → GREEN (minimum existing-function reuse) → REFACTOR, then full-suite check. Ponytail full: no new library or cross-phase abstraction without demonstrable need. Use GitHub-only isolated branch, **draft PR**, no merge/deploy/migration to hosted D1 without release acceptance. Test against a temporary database made from complete schema migration chain, not a production copy.

## 0. Baseline and contract inventory (no code change)
1. Inspect `server/core/handler.ts`, `server/modules/finance/{routes,service,types}.ts`, `server/modules/expenses/*`, cash-session route/service, `src/components/{FinancePanel,BankPanel,DayBookPanel}.vue`, and `react-integration/overlay/src/integration/{banijjApi,LiveReportsPage}.tsx`.
2. Extract a table of every current Finance/Bank/Expenses/Cash Session/Daybook route: method, permission, original posting tables, reversal, source ID, balance expected, currently covered test.
3. Record current migrations including active Phase 4 draft `0050`–`0053`; assign any new number only after upstream merge/rebase.
4. Run baseline `npm ci`, `npm run backend:build`, existing finance-relevant integration tests, `npm run react:build` and current CI scripts. Record failures, do not call them green.

## 6A. Read-only finance UI and reconciliation
- Tests first:
  - `tests/phase6-finance-readonly.integration.test.ts`: authenticated list reflects actual bank/finance rows; bank book/opening balances match only with complete provenance; mismatched balance is flagged, not asserted as known; GET leaves DB byte-level rows unchanged.
  - `react-integration/tests/phase6-finance-contract.test.mjs`: uses real `/api/finance/bootstrap`, `/api/bank/accounts`, `/api/bank/ledger`; screen rejects unauthenticated requests and does not fall back to demo values.
- Minimal implementation candidates:
  - `react-integration/overlay/src/integration/LiveFinancePage.tsx`
  - `react-integration/overlay/src/integration/banijjApi.ts` typed existing methods, not a second HTTP wrapper.
  - Existing app navigation routing by approved React integration's actual router; keep blue/compact HisabIQ style.
  - Update `server/modules/finance/service.ts` only for a failing, demonstrated read/reconciliation gap.
- Gate: source-backed accounts/persons/ledger open; discrepancy explicitly displayed; phone/tablet/desktop work.

## 6B. Bank/mobile and cash transfer safeguards
- Tests first: `tests/phase6-bank-transfers.integration.test.ts`
  1. Valid bank-bank transfer writes exactly balanced outgoing/incoming bank-book rows and one transfer reference.
  2. Cash-bank transfer has the correct cash-book counterpart; opening float is never inflow.
  3. Invalid account, same-account transfer, negative/zero amount, duplicate request ID with altered payload, insufficient funds where forbidden: no state mutation.
  4. Concurrent same-ID submissions and forced failure after first ledger leg leave no partial account, bank-book or cash-book state.
  5. Reversal posts compensating entries back to original accounts once, preserves audit, and never double-reverses.
- Minimal changes only in existing `server/modules/finance/{routes,service,types}.ts` and React Finance panel. Do not rework Phase 4 supplier-settlement or Phase 3 tender posting.
- Gate: all bank/mobile cases trace to one authentic account ledger and D1 atomic transaction.

## 6C. Cash session lifecycle and counted-vs-expected
- Tests first: `tests/phase6-cash-sessions.integration.test.ts`: single open session; retry/restart idempotency; expected cash derived from opening float plus only qualifying cash book events; counted cash and variance recorded; restricted variance close; date/time and actor evidence; concurrent close consistency; forced rollback.
- Reuse existing POS start endpoint and existing cash_sessions table before extending schema/routes. Add smallest necessary closing endpoint only after tests show no suitable existing one.
- React UI places Start/Close in approved compact Finance/Counter workflow without duplicating POS session logic.
- Gate: no fake balance adjustments or double-counting of day start.

## 6D. Finance Person Ledger
- Tests first: `tests/phase6-person-ledger.integration.test.ts`: Owner vs Lender separation, investment/withdrawal/borrowing/repayment accounting, person ID not name aggregation, backdating audit, original account reversal, no lender-as-sales revenue, permission/no double apply, forced rollback.
- Reuse `finance_persons`, `finance_transactions`, existing finance routes and source-linked ledger history.
- Build React person selector and ledger with existing underlined tabs, explicit date/calendar/50-100 page sizes.
- Gate: independent balances always reconcile with original financing movements.

## 6E. Unified Daybook
- Tests first: `tests/phase6-daybook.integration.test.ts`: every supported posted source appears once, deterministic dated pagination and 50/100 page sizes; selected date vs created-at sort; no draft as posted; backdated source clear; original record authorization; only original domain can edit/reverse; aggregate money-in/out not inflated by bank-to-bank transfer; source GET no writes.
- Reuse existing daybook handlers and `src/components/DayBookPanel.vue` interaction contract as reference; new `react-integration/overlay/src/integration/LiveDaybookPage.tsx` is native React only.
- Gate: filter/calendar, original link, print selected and action permissions pass responsive Playwright.

## 6F. Expenses and bank reconciliation
- Tests first: `tests/phase6-expenses-reconciliation.integration.test.ts`: expense category/payee lifecycle; cash vs bank paid; cancellations reverse actual source; repeated requests/forced rollback; unmatched book entries lead to incomplete state; no statement-line matching claims absent statement evidence.
- Extend existing `server/modules/expenses/*` only to close proven gaps; link to Finance view/Daybook. Do not alter Report Library layout or produce Business Audit.
- Gate: no double counted expense when crossing cash/bank/finance history.

## 6G. Contract and end-to-end acceptance
- Add `react-integration/tests/phase6-finance-source-parity.test.mjs` and finance/daybook Playwright scenarios using real API/isolated database, axe at 390/768/1440, mouse/keyboard and Bangla helper labels.
- Run full existing suite plus `npm run backend:build`, `npm run react:build` (and the repo's own exact-head GitHub Actions). Include explicit permission matrix for anonymous/staff/admin.
- Publish a source-of-truth reconciliation matrix of cases: cash, bank, mobile, owner, lender, expense, POS refund, supplier payment, internal transfer; if a Phase 3/4 posting contract isn't yet merged, mark the integration case blocked rather than altering that upstream phase.
- Release checklist: exact-head green CI; separate financial review, production D1 schema audit/backup, preview sign-off; no auto-merge, no hosted deployment and no production promotion.

## Cross-branch change policy
- Phase 6 branch stays off current `main`; it must not absorb Phase 3/4 drafts or modify Phase 5 Reports routing just to speed local tests.
- If Phase 3 or 4 changes shared source posting schema, open an integration issue with exact contract and update Phase 6 test fixtures only after reviewed rebase.
- Break up implementation into small draft PRs/commits per subphase as needed; avoid stacking unrelated migrations or treating planning PR green as proof of implementation.

## Self-review checklist (plan completeness)
- Every design subphase 6A–6G has concrete tests, candidate files and a gate.
- Existing application services and UI references are reused rather than reimplemented.
- Critical invariants have negative/concurrency/rollback tests.
- Business Audit, standalone Advisor and SaaS billing are excluded from Phase 6.
- Financial and production security restrictions are explicit.
