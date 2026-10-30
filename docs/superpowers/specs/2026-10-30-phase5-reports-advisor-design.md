# HisabIQ Phase 5 — Reports, Business Advisor & Audit Reporting (Approved Design)

**Date:** 2026-10-30  
**Status:** Phase scope approved; design specification for implementation; not implemented/released.  
**Repository:** shoaibadmi-sec/BanijjIQ  
**Isolated branch:** feat/hisabiq-phase5-reports-advisor  
**Integration policy:** Phase 3 (draft PRs #18–#20) and Phase 4 (draft PR #21) develop independently. This branch starts at \`main\` and must not cherry-pick incomplete accounting or purchasing changes.

## Intent

Deliver a verified, compact, low-literacy-friendly reporting surface for Bangladesh hardware/electrical retailers, using the approved HisabIQ React design with real Hono/Cloudflare D1 data. Simplify overlapping Report Library navigation, surface evidence-backed decisions, and print an accurate 4–5-page A4 internal business audit.

## Goals

1. Preserve the original pinned HisabIQ React report styling, charts, bilingual copy, compact tables, blue-brand look, responsive controls, keyboard use and source-row click-through. Use a generated integration overlay; never edit the pinned upstream submodule to retrofit live data.
2. Use existing \`/api/reports/*\`, \`/api/daybook\`, finance and expense read logic as vetted foundations; add narrowly scoped read-only report endpoints where gaps exist. Audit existing aggregates before relying on them.
3. Consolidate duplicate outside/inside report destinations: one Report Library; main sections as sidebar destinations; section-level underline tabs; preserve filters and per-report column visibility.
4. Provide 5C sales/profit, 5D stock/dues, 5E cash/bank/expenses, 5F Business Advisor, and 5G A4 business audit, with real sources and clear completeness indicators.
5. Support dates, server-side filter/search/sort/pagination (50/100 rows), totals independent of page, export/print of server-verified data, and link to underlying invoices/transactions.
6. Enforce authentication, reports.view RBAC, and subscribed feature entitlements server-side (reuse existing plan/tenant policy, or show gated/unavailable where missing).
7. Accept each slice only after test-driven local SQLite/full-migration, isolated Wrangler D1, mocked/browser Playwright and accounting reconciliation evidence.

## Non-goals and anti-goals

- NO posting, correcting, auto-reconciling, or backfilling live transactions from reports.
- NO production database writes, remote migrations, hosted deployment or PR merge until separate release acceptance.
- NO demo-store data on live report routes, no invented figures, no silent substitute for missing FIFO or ledger data.
- NO rebuilding the Magic Patterns presentation, wholesale React or Vue redesign, or migration away from pinned HisabIQ React.
- NO conflating bank transfers/supplier debt settlement/store-credit redemption with sales revenue.
- NO duplicate navigational destinations for Sales & Profit or other report categories.
- NO auto-enabling features that depend on unmerged Phase 3/4 contracts.

## Repository facts checked on 2026-10-30

- Existing backend: \`server/core/handler.ts\` delegates reporting to \`server/modules/reporting/routes.ts\` and \`service.ts\`. Existing GET routes include \`/api/reports/bootstrap\`, \`/sales\`, \`/purchase\`, \`/stock\`, \`/cash-bank\`, \`/profit\`, \`/balance-sheet\`, plus \`/api/dashboard\`, \`/api/daybook\`.
- \`server/modules/auth/permissions.ts\` maps \`/api/reports/*\` to reports module permission; \`/api/dashboard\` uses dashboard permission. New routes MUST remain under \`/api/reports/*\` and use GET only, with explicit deny tests.
- Existing \`getStockReportRoute\` has a \`lotMismatch\` flag; \`computeReportsProfit\` exposes missing-FIFO-lot coverage. These indicate gaps; they are not evidence that every historical report reconciles.
- React is pinned from \`shuvodelux-commits/hisabiq_ui\` via \`apps/hisabiq-web\` and built using \`scripts/prepare-hisabiq-react.mjs\` plus \`react-integration/overlay\`. Source \`src/pages/Reports.tsx\` currently uses \`useReportData\` and client-side preview models. There are reusable \`ReportsNav\`, \`ReportResults\`, \`ReportEvidencePanel\`, \`BusinessReview\`, and report chart components. Live view MUST not consume the preview data hook.
- \`.github/workflows/hisabiq-react-build.yml\` runs backend build, isolated accounting tests, React build, Playwright/axe and Wrangler local D1; its paths filter currently lacks \`server/modules/reporting/**\` and \`server/modules/finance/**\`, so Phase 5 must add reporting paths and new tests.
- The PRs for Phase 3 and Phase 4 are draft/unmerged. Current \`main\` is not equivalent to their accounting changes.

## Approaches considered

1. **Rewrite reports end-to-end:** costly, risks replacing approved styling and accounting logic. Rejected.
2. **Point existing preview Reports page at a fake or partial merged data store:** quick but gives false totals and unreviewable accounting. Rejected.
3. **Selected — live reporting adapter and incremental read-only backend endpoints:** preserve approved presentation components, build a separate authenticated live controller, verify evidence, gate unsupported metrics, and add safe report APIs progressively. Best isolation for simultaneous Phase 3–5 development.

## Architecture and contracts

- Keep current backend legacy endpoints for compatibility; add \`/api/reports/v2/catalog\`, \`/api/reports/v2/rows\`, \`/api/reports/v2/summary\`, \`/api/reports/v2/advisor\`, and \`/api/reports/v2/audit\` as GET-only endpoints. Contract version \`v2\` prevents untested changes to current consumers.
- A shared \`LiveReportRange\` (\`from\`, \`to\`) and \`LiveReportQuery\` (\`report\`, \`page\`, \`pageSize\`, \`search\`, \`sort\`, \`direction\`) are validated by an allowlist; invalid dates, excessive ranges, unsupported sort keys and invalid pagination return 400. PageSize allowed values are 50 and 100; cap data size and queries. Determine a reasonable bounded maximum period from performance tests and document it explicitly.
- Every monetary metric uses exact integer minor units internally where derived from transactions. Format BDT at the UI edge; do not aggregate rounded UI strings. Existing money storage may be decimal: use a tested, centralized conversion to integer cents and fail closed on non-finite/unsafe values.
- Every metric carries \`status: 'ready'|'needs-review'|'incomplete'|'unavailable'\`, \`reason\`, \`asOf\`, and \`sources\` (module, immutable source ID, optional date). \`value\` is nullable and stays null when unverified. Use source documents as canonical records, not arbitrary client calculations.
- \`LiveReportPage\` consumes \`banijjApi.ts\` GET-only helpers and backend session; React report charts and visual components remain the look-and-feel reference. No direct \`localStorage\` demo state is used for financial metrics. Query URL controls are canonical; UI preferences may be local only if strictly non-financial (visible columns, saved filters).
- Server pagination totals are computed independently of page slices. CSV/print must use authorized, bounded, server-derived rows and visibly state period + evidence status; do not print partial current page as a full report without labeling it.
- Report source links must be allowlisted to \`/app/sales\`, \`/app/purchases\`, \`/app/parties\`, \`/app/finance\`, \`/app/products\` or their actual implemented detail routes. Escape user-originated labels in print/CSV.
- Phase 3 changes (Store Credit, reversals) and Phase 4 changes (mixed-unit cost, purchase return and supplier settlement) enter only via stable, reconciled contracts after dependent PR release; otherwise corresponding report cells are marked incomplete/needs-review.

## Feature slices and acceptance

### 5A — Report Library & navigation

Reuse layout and charts from the approved source; sidebar for primary report categories, underline tabs within category, one library, compact table, mobile/tablet touch targets, bilingual helper. Live route replaces \`#/app/reports\` in generated copy; keep explicit \`reports-design-preview\` for visual parity. First release may show gated empty states for non-live datasets.

### 5B — Read-only reporting API and source records

GET-only v2 catalog/rows/summary contracts, auth/RBAC + plan enforcement, validated date/query allowlists, server-side pagination/filters, deterministic sort, evidence rows, explicit unsupported statuses, no financial write operations. Validate SQLite & isolated D1 interoperability and appropriate query indexing before any migration.

### 5C — Sales, returns & profit

Sales minus valid returns and discounts; FIFO COGS from actual allocation records (including return/reversal allocation where verified); expenses separately; show \`grossProfit\` and \`netProfit\` only if enough cost coverage exists. Reconciliation and as-of evidence. Incomplete on missing lot allocations, unresolved historical reversal or unreleased Store Credit integration.

### 5D — Stock, due and buying insight inputs

Lot valuation, low/out stock, slow/fast-moving with defensible date windows, expiry when verified, current receivable/payable and aging from reconciled source ledgers. If product stock differs from remaining lots, show mismatch and withhold trustworthy stock valuation. Avoid customer/party identity aggregation by display name alone.

### 5E — Cash, bank & expenses

Cash opening/closing and inflows/outflows; bank accounts with transfer-neutral treatment; expense-category summaries; finance loans/capital excluded from operating revenue. Store credit handled as liability after verified dependency. Red-flag ledger drifts; never guess adjusted balance.

### 5F — Business Advisor

Explain \`why\`, \`what to do\`, \`evidence\` per suggestion. Start with deterministic rules, no speculative AI figures: reorder, due follow-up, low stock, expiry and missing cost records. Only propose a purchase plan action if Phase 4 planner API is accepted and feature-authorized; otherwise show read-only recommendation.

### 5G — Business Audit Report

Print-friendly A4 4–5 pages, selectable monthly/yearly period, top-selling products, best customers and suppliers, stock, dues/payables, expenses, finance movements and verified profit; readable charts and evidence/coverage annex. Mark **Internal / Not certified**. Missing values render as \`—\` with reason, never zero. Desktop/tablet/phone previews all point to same server-sourced snapshots.

### 5H — Acceptance and integration

Backend integration tests on disposable full-schema SQLite, isolated real Worker/D1 (never remote), API permission gates, Playwright desktop/tablet/phone keyboard flows, screenshots, axe, source parity, CSV/print tests, accounting invariants, independent review, and controlled draft-only PR handoff.

## Concurrent branch safety

- Phase 5 branch owns \`server/modules/reporting/**\`, \`react-integration/overlay/src/integration/LiveReports*\`, \`react-integration/overlay/src/integration/reporting/**\`, report-specific tests and docs. Small additions to shared route injector/API adapter/CI must be reviewed against other branches before merging.
- Do not modify \`server/modules/sales/**\`, \`server/modules/purchases/**\`, \`server/modules/finance/**\`, \`server/modules/auth/**\` or migrations during 5A/5B unless a separately reviewed integration patch is explicitly required.
- Rebase only once upstream dependencies are accepted; never force update/rewrite other phase branches. Merge order depends on accepted interface contracts, not phase numbers alone.
- Each phase slice stays reversible and draft until local D1/Playwright plus accounting reconciliation passes. Hosted preview dispatch and release require separate explicit authorization.

## User acceptance criteria

The user can log in to HisabIQ and open the same approved compact Reports experience; see only real figures with source links; filter/print a safe business audit; receive actionable, evidence-based advisor suggestions; and trust that missing or unreconciled data is disclosed instead of invented. All changes remain isolated from other parallel phases and unreleased until release acceptance.
