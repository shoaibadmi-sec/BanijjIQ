# HisabIQ_UI React → BanijjIQ D1: source-fidelity inventory and API contract gaps

**Baseline:** the pinned `apps/hisabiq-web` React submodule, not the generated site or a `Live*` look-alike.
**Goal:** all real ERP operations must run through authenticated BanijjIQ APIs while preserving **the original source components, styling, responsiveness, layouts, keyboard/touch flows, and every existing action**. This is a baseline/gap inventory, **not** a claim that the ERP is fully integrated.
**Safety:** verified [DEMO] records in isolated preview D1 are real test transactions; original in-browser demo stores are **not** real business data. Do not expose their balances as real when a request fails.

## Live-route gap register (current main and held Dashboard PR #111)

| Original route / source | Current integration state | What must be done *before* UI parity can be accepted |
|---|---|---|
| `#/app/dashboard` / `src/pages/Dashboard.tsx`; original `components/dashboard/*` | Original source uses static metric/chart/recent-sales/dues fixtures. [Draft #111](https://github.com/shoaibadmi-sec/BanijjIQ/pull/111) connects summary API **by substituting five original widgets**. **HOLD / not source-faithful.** | Reconcile reporting evidence and feed **original** MetricCard, SalesTrendChart (14-day area/line), CashflowChart (monthly bars), RecentSalesTable (source payment/due status and original columns), DuesList (overdue chronology) through data adapters. Keep original widgets, Recharts visuals, card layout, links, customizer, Bangla labels, keyboard/touch, and all unavailable/error states. |
| `#/app/pos` / `src/pages/Pos.tsx` | Generated app routes to `LivePosPage`, original only via design-preview route. Real API supports several POS actions. **Replacement component not parity evidence.** | Inventory original POS actions and multi-unit/tracked product flows; fill missing authenticated backend features first, then wire the original POS. Keep identical cart/customer/payment/shortage/draft UX. Test money/stock/returns and screenshots. |
| `#/app/products` / `src/pages/Products.tsx` | Original generated page is patched by `patchLiveProducts` and API catalog is live. Source modifications require audit. | Match every original column/search/filter/show-hide/inline edit/product action/quick-add/detail workflow; create missing backend transaction/validation rules before enabling. Preserve exact table/edit UI. |
| `#/app/purchases`, `#/app/purchases/new` | Routed to `LivePurchasesPage` / `LivePurchaseEditorPage`, originals remain design-only. **Not UI-fidelity complete.** | Wire original purchase list, supplier/product search, multi-unit, lot/serial/expiry, payment, returns, planner, and dialog/actions to real purchases APIs. Test supplier ledger and FIFO/due/money-book reconciliation. |
| `#/app/reports` / `src/pages/Reports.tsx` | Replaced with `LiveReportsPage`; generated `ReportsNav` and `Reports` are patched to two tabs. Reporting v2 is source-backed but not full original report feature set. | Preserve original reports navigation, charts, tables, filters, drill-through/source links, planner/advisor and sections. Complete missing backend report models and permissions first. No unreconciled profit or fabricated chart data. |
| `#/app/sales` / `src/pages/Sales.tsx` | Original demo page still mounted. Sales Returns has a separate `live-sales-returns` route. | Add missing sales list/detail/status/return/allocation APIs. Connect all existing Sales tabs, invoice preview/edit/duplicate/returns and source-linked actions *inside original Sales UI*. |
| `#/app/parties` / `src/pages/Parties.tsx` | Original demo page mounted. | Implement exact combined customer/supplier party and ledger filters, payments, debit/credit, balance and business date pagination. Source-derived aging requires defensible invoice-level settlement chronology; do not guess overdue days. |
| `#/app/vendors` / `src/pages/Vendors.tsx` | Original demo page mounted. | Complete sourcing, settlement and vendor-ledger APIs, then connect original workspace, tabs, actions and balances. |
| `#/app/finance`, `#/app/counter`, `#/app/daybook`, `#/app/expenses`, `#/app/accounts` | Original demo routes still present; independent backend accounting features exist but are not equivalent to UI integration. | Map every original money in/out, bank/cash transfer, receipt/payment, expense, attachment, editing/deletion/reversal, ledger filter/pagination, opening-balance and cash-session workflow. TDD exact-poisha, double-entry/source integrity, idempotency and atomic rollback. |
| `#/app/settings/:section` / `src/settings/TenantSettingsPage.tsx` | Some generated Business/Team routes substituted by `LiveBusinessSettingsPage` / `LiveTeamSettingsPage`; other original sections may remain demo. | Wire original Settings widgets and complete RBAC/user management, units/brands/categories/device/tax/printing while preserving original tabs/directory/form structure. |
| Other ERP + SaaS routes | Mixed original demo, partial live and preview pages. | Inventory each original route and every action before claiming parity. No uncontrolled `Live*` replacements, no fake fallbacks. |

## Dashboard data-to-feature contracts (first critical feature backlog)

| Original widget | Actual source requirement | Current reporting v2 evidence | Gap / release gate |
|---|---|---|---|
| Six KPI metric cards | Today's net sales + comparison/invoice count; current customer/supplier dues; current cash/bank; gross profit/margin; low-stock count | `/api/reports/v2/summary` includes `netSales`, `grossProfit`, current receivable/payable/cash snapshots; `/api/bootstrap` exposes product stock. | Comparison, bank figure, margin and completeness status need independently reconciled source data; retain original icon/card/footers and links, never show fake 0 or percent. |
| Sales trend | 14-day sales and FIFO gross-profit `{day,sales,profit}` | Source-backed profit summary exists for bounded ranges but is **invoice-date cohort**, with return/expense safety checks. | Obtain source-verified per-day values, treat incomplete points as unknown, preserve exact Recharts AreaChart/Line/Tooltip markup. Avoid inventing historical profit. |
| Cashflow chart | Six months `{month,in,out}` | `readCashExpenses` provides `cashReceipts`, `cashPayments`, bank movements and journal validation over a bounded date range. | Define cash/bank inclusion and internal transfer exclusion; expose reconciled per-month series within request budgets. Preserve original Recharts BarChart/Tooltip. |
| Recent sales | Original invoice columns: invoice/date/time, customer, payment status, total, due | `/api/reports/v2/rows?report=sales` currently provides invoice ID/customer/date/recorded amount only (50/100 page size). | Persist and reconcile invoice-level post-sale allocations, payment statuses, outstanding due, method and exact source links. The original table must remain; no substitute `Recorded` column. |
| Dues to collect | Party name, amount, age/severity, click-to-party ledger | `/api/reports/v2/rows?report=receivables` supplies current snapshot balances; current report explicitly says aging **is unavailable**. | Implement open-invoice aging and allocation chronology with tests before showing overdue days/gradients or claiming the original dues workflow is live. |
| Dashboard header | Actual signed-in employee and stored shop name, date, Bangla text | Authenticated `/api/auth/me` and authorized `/api/settings/bootstrap`. | Do not display browser demo actor/shop; connect original header without changing its layout. |

**Accounting and performance note:** composing a dashboard from many independently verified period endpoints must respect Cloudflare Worker/D1 query and subrequest limits, RBAC, source consistency, and tenant isolation. Prefer a source-reconciled bounded backend aggregation rather than N+1 unbounded queries. A green mock test is not evidence that D1 works at scale.

## Implementation order (strict)

1. Freeze the pinned original React source/version, inventory each original action, and capture baseline 390/768/1440px screenshots and keyboard/touch interactions.
2. Build and test **missing backend functionality first** (financial evidence, per-day/per-month trends, invoice settlement allocations/aging, party ledger, remaining transactions) using authenticated real migrated SQLite/Worker D1; no direct demo-table writes or schema shortcuts.
3. Bind the **original** components via adapter/hooks/data props, preserving their JSX/visual rendering, routes, interactions, error and empty states. No feature deletion to work around a missing API.
4. RED→GREEN TDD for source behavior, Playwright baseline visual comparison, accessibility, real D1 accounting/permissions, backend and full UI tests. Require GitHub Actions passing on exact PR SHA and independent review.
5. Merge only after source fidelity, functionality and release gates are met. Hosted preview/production deploy and remote D1 migrations require separate explicit authorization.

## Review state

- [Source-fidelity policy PR #120](https://github.com/shoaibadmi-sec/BanijjIQ/pull/120): defines rules; not a fully integrated ERP.
- [Held Dashboard PR #111](https://github.com/shoaibadmi-sec/BanijjIQ/pull/111): **do not merge** until original widgets and behavior are preserved and missing backend contracts exist.
- [Source parity tracker #98](https://github.com/shoaibadmi-sec/BanijjIQ/issues/98): track integration and acceptance by module.

