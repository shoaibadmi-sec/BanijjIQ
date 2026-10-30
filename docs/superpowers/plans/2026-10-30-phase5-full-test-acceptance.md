# Phase 5 Full Reporting Test Acceptance — Implementation Plan

> **For agentic workers:** Use Superpowers test-driven-development and executing-plans. Every code change requires an observed failing regression test before the minimal production fix.

**Goal:** Verify the entire currently merged Phase 5 reporting surface and stop orphan cash/bank expense postings from certifying period expenses or net profit.

**Architecture:** Keep the existing GET-only React / Hono reporting stack. Exercise the real `handleApiRequest` with fully migrated in-memory SQLite and the existing isolated Worker/D1, Playwright and React source-parity CI. Use no mocks, new runtime dependencies, UI redesign, or migrations.

**Tech Stack:** TypeScript, Node built-in test/assert, SQLite migrations, Hono/Cloudflare Worker/D1, React source parity, Playwright/axe.

**Spec:** `docs/superpowers/phase5-reports-release-acceptance.md`; Phase 5F Business Audit remains deferred.

## Global constraints
- Phase 5 only; do not merge or touch Phase 3, 4 or 6 dependency branches.
- Preserve exactly two Reports main tabs: Dashboard, Report Library.
- `/api/reports/v2` remains authenticated, `reports.view` required, with `pos.view` for sales invoice read-only drill-down.
- Do not report unsupported product margin, whole-ledger P&L, ageing or audit as ready; no financial writes from GET.
- All date filters, pagination (50/100), source IDs and monetary values in minor units must remain sound.
- Production and hosted release stay HOLD until separately accepted.

## Coverage map and test ownership

| Phase 5 contract | Existing verification | Addition |
| --- | --- | --- |
| Dashboard / Library exactly two tabs; search, source navigation, date controls | `react-integration/tests/reports-two-tabs.contract.test.mjs`, `reports-live-route.test.mjs`, `reports-source-parity.test.mjs`, Playwright/axe | Catalog/report matrix below |
| All 13 report keys, unsupported status, safe summary/audit routes | `tests/reports-v2-route.integration.test.ts` | New `tests/reports-phase5-acceptance.integration.test.ts` |
| Auth `reports.view`, no mutation, invalid methods and query bounds | `tests/reports-v2-route.integration.test.ts`, `reports-v2-query.integration.test.ts` | Cross-endpoint 401/403/GET matrix |
| Sales pagination/search, posted vs draft, null untrusted profit | `reports-v2-route.integration.test.ts`, `reports-sales-profit.integration.test.ts` | Multi-source route/money evidence |
| FIFO sale, discount, returns, duplicate restoration, 5000 invoice cap | `reports-sales-profit.integration.test.ts` | Regression suite kept in full CI |
| Stock original cost/current snapshot; dues customer/supplier ID and aging unavailable | `reports-stock-dues.integration.test.ts`, route tests | Source identity checks |
| Bank/cash transfer, expenses, finance, read-only source validation | `reports-cash-expenses.integration.test.ts`, route tests | Orphan expense source RED→GREEN |
| API/React/real Worker/D1 acceptance | `react-integration/tests/reports-*.test.mjs`, `d1-checks/run.mjs`, `ui-checks/run.mjs` | Exact-head required CI |

## Task 1: Full API acceptance matrix
- [ ] Add `tests/reports-phase5-acceptance.integration.test.ts`: authenticated/unauthenticated/denied access to all 13 report keys, catalog/summary/audit, unsupported/unavailable states, 400 validation, stable source IDs and no DB writes.
- [ ] Run via GitHub Actions reports integration stage; investigate any unexpected results without weakening guards.

## Task 2: Orphan expense posting integrity (TDD)
- [ ] Add failing `tests/reports-cash-expenses.integration.test.ts` regression for an active cash-book Expense posting without an active expense source.
- [ ] Add failing `tests/reports-sales-profit.integration.test.ts` regression: otherwise reconciled FIFO sale with orphan expense posting must withhold net profit.
- [ ] Verify RED via exact-head GitHub CI and inspect failing assertions.
- [ ] Make the smallest shared `server/modules/reporting/live/cash-expenses.ts` source-reconciliation guard, preserving all existing valid postings.
- [ ] Verify GREEN including full reporting, TypeScript, React build, D1 Worker, Playwright/axe.

## Task 3: Release gate
- [ ] Review diff, confirm only Phase 5 tests/shared report reader/docs, no new dependencies.
- [ ] Merge only after exact-head CI success and mergeability; do not deploy.
- [ ] Leave Phase 5 production acceptance HOLD until Phase 3/4/6 financial dependencies, Issue #35 and hosted read-only validation are independently resolved.

## Review focus
1. Active orphan money-book Expense posting: fail closed rather than silently understate operating costs.
2. Historical reversed/deleted expense headers: do not falsely certify orphan postings without evidence.
3. Cash vs bank source identities: verify record references as well as amounts.
4. Filtered/paged periods: never mistake a sampled amount for a whole-period total.
5. Unavailable Phase 5 features: never turn an empty result into a certified zero.
