# Phase 5 — Reports, Business Advisor & Audit Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship authenticated real-D1 reporting, verified business insight and a printable 4–5-page A4 internal audit, while preserving the approved HisabIQ React reporting UI and remaining isolated from Phase 3 and 4 draft accounting branches.

**Architecture:** Add read-only `/api/reports/v2/*` endpoints and small dedicated reporting services under `server/modules/reporting/live/`; keep legacy API compatibility. Inject a live React report controller via the existing generated-copy overlay, reuse pinned report presentation components without reading preview/demo stores, and expose explicit evidence/coverage states. Merge only after integration and financial acceptance; no production/remote DB changes.

**Tech Stack:** TypeScript, React + existing HisabIQ UI/shadcn/Tailwind, Hono, Cloudflare Workers D1/SQLite `SherDatabase`, Node 22+ built-in test + tsx, Wrangler local D1, Playwright Chromium + axe, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-30-phase5-reports-advisor-design.md`

## Global Constraints

- Parent: `main`; working branch: `feat/hisabiq-phase5-reports-advisor`. Phase 3 PRs #18–#20 and Phase 4 PR #21 stay draft; do not import unfinished accounting changes.
- All read endpoints under `/api/reports/v2/` and GET-only, guarded by existing `reports.view` RBAC. Feature-level entitlements are server-enforced or conspicuously gated until available.
- Never write through the report APIs, alter transaction source tables, or backfill financial records. No production DB, no remote D1, no hosted preview, no auto-merge or production deploy.
- Original pinned `apps/hisabiq-web` submodule remains unchanged; use `react-integration/overlay` and `scripts/prepare-hisabiq-react.mjs`. Keep HisabIQ blue branding, Magic Patterns charts, bilingual helper, compact tables and responsive behavior.
- Financial metrics use integer paise/cents internally, clear nullable evidence statuses, tested source lineage, and no fake demo values in live routes. Incomplete reconciliation means nullable metric, not fabricated zero.
- Treat returns/reversals, FIFO original cost, Store Credit liabilities, supplier payable, transfers and capital separately. Historical data inconsistencies must fail closed with visible reason.
- Report rows use authenticated source IDs; date/filter/sort/page are strict allowlists; only pageSize 50/100. Date-range performance cap is specified and tested before rollout.
- Add `server/modules/reporting/**`, related overlay/tests/doc paths to GitHub Actions filters so reporting-only PRs run required CI.
- Every task is test-first: red test, run failing test, minimal implementation, green test, commit, independent review. No success claims without exact-head CI evidence.

## Code/file ownership map

| Component | Responsibility |
| --- | --- |
| `server/modules/reporting/live/types.ts` | Public v2 JSON contracts: `ReportStatus`, `EvidenceSource`, `ReportMetric`, `LiveReportRow`, `LiveReportPage`, `AdvisorInsight`, `AuditBook` |
| `server/modules/reporting/live/query.ts` | Strict `parseLiveReportQuery(url: URL)` and `parseLiveReportRange(url: URL)` validation; allowlisted report types/sorts |
| `server/modules/reporting/live/routes.ts` | `handleLiveReportsRoute(db,request,path)`: pure GET-only dispatch |
| `server/modules/reporting/live/catalog.ts` | Available report categories, role/entitlement flags, source availability states |
| `server/modules/reporting/live/sales-profit.ts` | Source-backed sales/returns/FIFO costing and profit/coverage |
| `server/modules/reporting/live/stock-dues.ts` | Physical lot valuation, inventory anomalies, receivable/payable and aging |
| `server/modules/reporting/live/cash-expenses.ts` | Cash/bank/expenses/finance presentation, transfer-neutral reporting |
| `server/modules/reporting/live/advisor.ts` | Deterministic insights and evidence links |
| `server/modules/reporting/live/audit.ts` | Shared A4 audit JSON snapshot and readiness; no database changes |
| `server/modules/reporting/routes.ts` | Call v2 dispatcher before legacy GET cases (only additive) |
| `react-integration/overlay/src/integration/reporting/*` | Live React report model/client helpers, table/nav/charts and audit print |
| `react-integration/overlay/src/integration/LiveReportsPage.tsx` | Authenticated Report Library screen; never reads preview financial store |
| `react-integration/overlay/src/integration/banijjApi.ts` | GET-only typed v2 report client methods |
| `scripts/prepare-hisabiq-react.mjs` | Route `reports` to live page, preserve design-only `reports-design-preview` |
| `tests/reports-*.integration.test.ts` | Full-schema SQLite API/accounting invariants |
| `react-integration/tests/reports-*.test.mjs` | Source parity and route contracts |
| `ui-checks/reports.mjs` and `ui-checks/run.mjs` | Mocked-browser desktop/tablet/phone/axe/print checks |
| `d1-checks/run.mjs`, `.github/workflows/hisabiq-react-build.yml` | Real local Worker/D1 read gates, CI trigger and artifacts |

The directories/files listed as new are proposed creation paths; preserve existing source patterns and only add referenced imports after tests. Do not refactor the large existing `server/modules/reporting/service.ts` wholesale.

## Review Focus — failure cases that each task must test

1. An invalid date or unbounded row query must return 400 without scanning a huge date window (Task 2).
2. A non-report user or a valid user lacking the feature entitlement must never see protected report values (Tasks 1–2).
3. A return/reversal or missing FIFO allocation must not produce an overstated or falsely precise net profit (Task 3).
4. Stock-lot/master mismatch and customer/supplier ledger drift must be visible and withhold dependent values (Task 4).
5. Hostile labels in CSV/A4, zero-data periods, and a phone-size print preview must render safely without XSS or fake zero totals (Task 7).

---

## Task 1 (5A) — Live Report Library route, navigation and UI skeleton

**Files:** Create `react-integration/overlay/src/integration/LiveReportsPage.tsx`, `react-integration/overlay/src/integration/reporting/ReportNav.tsx`, `react-integration/tests/reports-live-route.test.mjs`. Modify `scripts/prepare-hisabiq-react.mjs`, `react-integration/overlay/src/integration/BackendGate.tsx` only if preview wording needs clarification.

**Interfaces:** Consumes `useBackendSession()`, `canUseModule(user,'reports')`, original pinned `PageHeader`/`ReportsNav`/`ReportResults` styling. Produces `LiveReportsPage(): JSX.Element` and stable `#/app/reports`, `#/app/reports-design-preview` routes. This task uses read-only explicit unavailable states; no synthetic financial rows.

- [ ] **Step 1 — Red:** Add `reports-live-route.test.mjs` to assert the route injector references the pinned `<Route path="reports" element={<Reports />} />` anchor and emits a live route plus a separate design-preview route; the new page uses `canUseModule`, never `useReportData`, and has real loading/error/empty states and 50/100 pagination controls.
- [ ] **Step 2 — Verify red:** Run `node --test react-integration/tests/reports-live-route.test.mjs`; expected missing-file or failed route assertion.
- [ ] **Step 3 — Implement:** Add the route injection with fail-closed anchor checks, sidebar-style primary report navigation and underline subsection tabs; keep original approved presentation tokens/charts and prevent demo data from being rendered on the live route. Do not rewrite pinned source.
- [ ] **Step 4 — Green:** Run the contract test and `npm run react:build`; both must pass without modifying `apps/hisabiq-web`.
- [ ] **Step 5 — Commit:** `git add scripts/prepare-hisabiq-react.mjs react-integration && git commit -m "feat(reports): add isolated live report library shell"`.

## Task 2 (5B) — Validated v2 read-only report contracts

**Files:** Create `server/modules/reporting/live/types.ts`, `query.ts`, `catalog.ts`, `routes.ts`, `tests/reports-v2-contract.integration.test.ts`; modify `server/modules/reporting/routes.ts` and `react-integration/overlay/src/integration/banijjApi.ts`.

**Interfaces:** `parseLiveReportRange(url:URL): {from:string;to:string}`, `parseLiveReportQuery(url:URL): LiveReportQuery`; `handleLiveReportsRoute(db:SherDatabase,request:Request,path:string): Promise<Response|null>`. Define `ReportStatus = 'ready'|'needs-review'|'incomplete'|'unavailable'`; `EvidenceSource = {module:string;sourceId:string;date:string|null}`; `ReportMetric = {key:string;valueMinor:number|null;status:ReportStatus;reason:string;asOf:string;sources:EvidenceSource[]}`; `LiveReportPage = {ok:true;range:LiveReportRange;report:string;page:number;pageSize:50|100;totalRows:number;rows:LiveReportRow[];metrics:ReportMetric[];coverage:{status:ReportStatus;reasons:string[]}}`. Use exportable `request<T>` already in `banijjApi.ts`.

- [ ] **Step 1 — Red:** Add full-migrations in-memory API tests: unauthenticated GET => 401; role without reports.view => 403; GET `/api/reports/v2/catalog` authorized => 200; invalid date `2026-02-30`, reversed dates, page=0, pageSize=500, unknown `sort`, unknown `report`, and date range beyond documented cap => 400. POST to v2 must not dispatch. Assert record counts and `total_changes()` unchanged across allowed reads.
- [ ] **Step 2 — Verify red:** `node --import tsx --test tests/reports-v2-contract.integration.test.ts`; missing endpoints/tests must fail.
- [ ] **Step 3 — Implement:** strict query parsing; route-only GET dispatch with `/api/reports/v2/catalog`, `/rows`, `/summary`, `/advisor`, `/audit` (unimplemented slices respond `unavailable`, not fake data); bind parameters, stable sort `date DESC,id DESC`, defaults `page=1,pageSize=50`, allowlist, and explainable `coverage`. Initially cap period at 366 days and test this exact cap. Defer new indices unless query plan evidences a need.
- [ ] **Step 4 — Green:** Run the v2 contract test and `npm run backend:build`; validate no existing `/api/reports/*` behavior changed.
- [ ] **Step 5 — Commit:** `git add server/modules/reporting react-integration/overlay/src/integration/banijjApi.ts tests && git commit -m "feat(reports): add authorized read-only v2 contract"`.

## Task 3 (5C) — Sales, returns, profit, and FIFO evidence

**Files:** Create `server/modules/reporting/live/sales-profit.ts`, `tests/reports-sales-profit.integration.test.ts`. Extend `routes.ts`, typed v2 client, and live page sections.

**Interfaces:** `readSalesProfit(db:SherDatabase,query:LiveReportQuery): Promise<LiveReportPage>` with report identifiers `sales` and `profit`. Consume `sales`, `sale_items`, `sales_return_items`, `sale_item_lots` plus verified reversal status; use `computeReportsProfit` only where reconciled.

- [ ] **Step 1 — Red:** Fixture: two units sold at 120 BDT each, 20 BDT invoice discount, FIFO cost 70 BDT each, 20 BDT operating expense, one unit returned for 110 BDT with cost reversal 70 BDT. Verify gross originally 220, net revenue 110, surviving COGS 70, gross profit 40, net profit 20; discount/return not double counted. Second fixture omits a cost allocation: profit metric must be null with `incomplete`. Test source IDs + totalRows across two pages and stale reversal coverage.
- [ ] **Step 2 — Verify red:** `node --import tsx --test tests/reports-sales-profit.integration.test.ts`; expected FAIL for missing implementation.
- [ ] **Step 3 — Implement:** bounded source aggregation and invariant checks; report net sales, discounts, returns, FIFO COGS and expenses independently; link each line to immutable invoice/product/lot evidence. Do not treat bank settlement, credit redemption, or customer due as sales; if Phase 3 reversal provenance is not yet available, refuse to certify that metric.
- [ ] **Step 4 — Green:** Run task test plus `node --import tsx --test tests/pos-accounting.integration.test.ts`; both pass.
- [ ] **Step 5 — Commit:** `git add server/modules/reporting/live tests react-integration && git commit -m "feat(reports): reconcile sales and fifo profit"`.

## Task 4 (5D) — Inventory valuation, due and aging

**Files:** Create `server/modules/reporting/live/stock-dues.ts`, `tests/reports-stock-dues.integration.test.ts`; add corresponding report UI views.

**Interfaces:** `readStockDues(db:SherDatabase,query:LiveReportQuery): Promise<LiveReportPage>`, identifiers `stock`, `receivables`, `payables`, `aging`.

- [ ] **Step 1 — Red:** Seed 2 stock lots at different unit cost and assert sum(remainingQty*originalCost); seed mismatch with `products.current_stock` and assert stock valuation becomes null/`needs-review` for affected SKU. Include zero stock, inactive product, no recent movement (slow mover), negative stock, duplicate party names with distinct IDs, and supplier ledger balance different from master payable; no cross-party aggregation.
- [ ] **Step 2 — Verify red:** `node --import tsx --test tests/reports-stock-dues.integration.test.ts`; expected missing handler failures.
- [ ] **Step 3 — Implement:** use lot rows, date-bounded movement data and durable party IDs; fixed aging buckets 0–30, 31–60, 61–90, >90 days relative to requested `to`. If original open-item settlement cannot be proven on current `main`, expose a clearly labeled `current balance only` view and mark invoice-aging `unavailable` until Phase 3/4 reconciliation.
- [ ] **Step 4 — Green:** Run task test plus `npm run backend:build`, assert no GET writes.
- [ ] **Step 5 — Commit:** `git add server/modules/reporting/live tests react-integration && git commit -m "feat(reports): expose stock and due evidence"`.

## Task 5 (5E) — Cash/bank/expense and finance movement summaries

**Files:** Create `server/modules/reporting/live/cash-expenses.ts`, `tests/reports-cash-expenses.integration.test.ts`; extend live report view.

**Interfaces:** `readCashExpenses(db:SherDatabase,query:LiveReportQuery): Promise<LiveReportPage>`, identifiers `cash`, `bank`, `expenses`, `finance`.

- [ ] **Step 1 — Red:** Test opening cash 500, sale cash receipt 200, expense cash out 50, inter-account bank transfer 100, and owner capital inflow 300: cash/bank movement reconciles; transfer and capital do not inflate sales/profit; only true expense hits operating expense; an account master/ledger balance discrepancy => nullable closing balance with `needs-review`. Include a cash-session opening amount that must not double count as an external receipt.
- [ ] **Step 2 — Verify red:** `node --import tsx --test tests/reports-cash-expenses.integration.test.ts`; expected FAIL.
- [ ] **Step 3 — Implement:** source-type classification over existing `cash_book`, `bank_ledger`, `expenses`, `finance_transactions` as actually named in schema; check historical opening-vs-flow convention and reconcile against stored account balances; separate finance transfers and liability flows.
- [ ] **Step 4 — Green:** Run task test, full `tests/pos-accounting.integration.test.ts`, backend build.
- [ ] **Step 5 — Commit:** `git add server/modules/reporting/live tests react-integration && git commit -m "feat(reports): reconcile cash bank and expenses"`.

## Task 6 (5F) — Deterministic Business Advisor with traceable evidence

**Files:** Create `server/modules/reporting/live/advisor.ts`, `tests/reports-advisor.integration.test.ts`, `react-integration/overlay/src/integration/reporting/BusinessAdvisor.tsx`; add v2 advisor routing.

**Interfaces:** `buildAdvisorInsights(db:SherDatabase,query:LiveReportQuery): Promise<AdvisorInsight[]>`, where `AdvisorInsight={id:string;severity:'info'|'warning'|'urgent';title:string;why:string;action:string;status:ReportStatus;source:EvidenceSource[];targetRoute:string|null}`.

- [ ] **Step 1 — Red:** Seed low stock, fast-moving items, stale overdue receivables, expiring eligible batch, and missing FIFO evidence; verify insight only when source is traceable, priority deterministic and empty/unreconciled data produces explanation instead of invented score. Verify advisor never posts or creates purchase orders.
- [ ] **Step 2 — Verify red:** `node --import tsx --test tests/reports-advisor.integration.test.ts`; expected FAIL.
- [ ] **Step 3 — Implement:** a small explicit rule set; bilingual clarity in UI and source links. Buying recommendation is read-only until Phase 4 planner API is accepted; no ML inference of financial values.
- [ ] **Step 4 — Green:** Run task test and `npm run react:build`.
- [ ] **Step 5 — Commit:** `git add server/modules/reporting/live tests react-integration && git commit -m "feat(reports): add evidence-backed business advisor"`.

## Task 7 (5G) — 4–5-page A4 monthly/yearly Business Audit

**Files:** Create `server/modules/reporting/live/audit.ts`, `tests/reports-audit.integration.test.ts`, `react-integration/overlay/src/integration/reporting/AuditBook.tsx`, `react-integration/overlay/src/integration/reporting/printAuditBook.ts`; extend live page and v2 audit route.

**Interfaces:** `getAuditBook(db:SherDatabase,range:LiveReportRange): Promise<AuditBook>` and `renderAuditHtml(book:AuditBook):string`. Sections include summary/KPI, sales and products, stock and dues, finance and expenses, evidence/coverage. `AuditBook` includes `period`, `generatedAt`, `sections`, `readiness`, `sources`.

- [ ] **Step 1 — Red:** Test month/year selectors and exact date boundaries; 4–5 A4 pages with CSS `@page`, source counts, top selling products/customers/suppliers, expenses and finance; missing FIFO profit value renders `—` with reason; all printed pages say `Internal / Not certified`. Inject a product label `<script>alert(1)</script>` into a fixture; assert HTML escaping and no executable script; blank periods preserve `unavailable` vs numeric 0 distinction. A page must not silently omit more evidence than the summary claims.
- [ ] **Step 2 — Verify red:** `node --import tsx --test tests/reports-audit.integration.test.ts`; expected FAIL.
- [ ] **Step 3 — Implement:** server-sourced bounded snapshot, category chart data (use approved Magic Patterns visuals), escaped print HTML, A4 print styling, visibly labeled source-date and readiness footnotes; CSV exports use escaped fields and correct UTF-8 BOM for Bangla if needed. Show manual print/export from same snapshot.
- [ ] **Step 4 — Green:** Run task test and `npm run react:build`; manually review generated print in Chromium/Playwright for page clipping before acceptance.
- [ ] **Step 5 — Commit:** `git add server/modules/reporting/live tests react-integration && git commit -m "feat(reports): add source-backed a4 audit book"`.

## Task 8 (5H) — Full isolated D1, Playwright, security and release gate

**Files:** Create `ui-checks/reports.mjs`, `react-integration/tests/reports-source-parity.test.mjs`; modify `ui-checks/run.mjs`, `d1-checks/run.mjs`, `.github/workflows/hisabiq-react-build.yml`, `docs/superpowers/phase5-reports-release-acceptance.md`.

**Interfaces:** Existing `ui-checks/run.mjs` reporter and `d1-checks/run.mjs` local Worker test harness, plus Task 1–7 public routes. No production/hosted invocation.

- [ ] **Step 1 — Red:** Add failing tests for report-only code changes triggering CI; unauthenticated + limited RBAC requests; mocked and real-local-D1 `GET /api/reports/v2/*` parity; laptop/tablet/phone screenshots; keyboard and click-through; filtering 50/100; CSV/print; WCAG axe; no preview demo data; 4–5-page clipped-free print; zero real writes. Test `apps/hisabiq-web` pinned source remains pristine.
- [ ] **Step 2 — Verify red:** Run `node --test react-integration/tests/reports-source-parity.test.mjs` and `node ui-checks/run.mjs` after `npm run react:build`; new assertions fail before wiring.
- [ ] **Step 3 — Implement:** Add reporting/code/doc path filters to the CI workflow, contract/backend tests to `node --import tsx --test ...`, report UI checks to `ui-checks/run.mjs`, Worker/D1 read-only checks to `d1-checks/run.mjs`, report artifacts, and release checklist including exact-head links and historical reconciliation dependency notes. Use only isolated `wrangler.d1-ci.jsonc` with `--local --persist-to`; never `--remote`.
- [ ] **Step 4 — Green:** Run `npm run backend:build`, all `tests/reports-*.integration.test.ts`, `node --test react-integration/tests/reports-*.test.mjs`, `npm run react:build`, `node ui-checks/run.mjs`, `node d1-checks/run.mjs`. On GitHub record the exact SHA and all jobs; skipped hosted-preview jobs are explicitly **not** passes.
- [ ] **Step 5 — Commit:** `git add .github/workflows/hisabiq-react-build.yml d1-checks ui-checks react-integration/tests docs/superpowers && git commit -m "test(reports): add isolated d1 browser and release gates"`.

## Cross-phase integration and PR handoff

1. Keep Phase 5 on its own draft PR; never enable auto-merge.
2. For any upstream Phase 3/4 change, compare actual accepted response/schema contract; do not cherry-pick unmerged migrations merely to make reports pass.
3. After Phase 3 liability/reversal and Phase 4 purchasing/supplier contracts are accepted, run additional financial reconciliation acceptance on a copied, scrubbed, isolated database; upgrade only metrics whose evidence is complete.
4. Review table/chart parity with pinned HisabIQ UI and guard against duplicate navigation. Confirm blue/compact responsive UX.
5. Independent reviewer signs off money formulas, RBAC, D1 permissions, exact-head Playwright/axe/print artifacts. Hosted isolated preview requires explicit separately authorized deploy; production requires distinct release acceptance.

## Self-review matrix

| Spec item | Owning task |
| --- | --- |
| Single navigation, pinned UI, no demo financial data | 1, 8 |
| Validated read API, privacy, entitlement, pagination, filters | 2, 8 |
| Sales/returns/discount/FIFO/expenses | 3 |
| Lot values, moving stock, dues, aging, anomalies | 4 |
| Cash/bank/expenses/capital | 5 |
| Evidence-backed Business Advisor | 6 |
| A4 audit month/year, charts, print/export | 7 |
| Local SQLite/D1, Playwright/axe/security, cross-phase release gates | 8 |

**Approval/execution:** Scope approved 2026-10-30; this file is the implementation handoff. Do not claim Task 1–8 implemented or passing merely because this documentation exists. At each implementation slice, update the checklist and draft PR with exact commit SHA/CI links.
