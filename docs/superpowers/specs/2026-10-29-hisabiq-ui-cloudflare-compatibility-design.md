# HisabIQ_UI React ↔ BanijjIQ Cloudflare compatibility
**Superpowers design proposal — awaiting user approval, NOT an implementation/release authorization**
**Date:** 2026-10-29
**Working branch:** `feat/hisabiq-react-api`, draft PR #9
**Source of UI truth:** pinned `shuvodelux-commits/hisabiq_ui` at `9a8dc1ac4e85ac4e60f254e068bd67c2a805673f`
**Cloudflare target:** existing Hono Worker + SQLite-compatible D1 interfaces; separate isolated React preview

## 1. Intent and context

Build the capabilities exhibited by the **existing original HisabIQ_UI React workflow** into the BanijjIQ backend, then bind that backend to the original page components **without redesigning those components**. The result must be a fully functional, information-rich, compact ERP for Bangladeshi hardware/electrical shops, not a visually different second ERP.

The user has confirmed that the current Cloudflare-hosted React preview can authenticate, create a real product, post a basic real sale and reduce real D1 inventory. However, it also renders sample fixtures on non-integrated pages, and its current live Products/POS use separate `LiveProductsPage` and `LivePosPage` implementations that deviate from the approved HisabIQ design. Those are transitional implementations, **not the final visual authority**.

## 2. Binding decisions and constraints

1. **Original UI visual contract is authoritative.** Preserve the source `src/pages/Pos.tsx`, `Products.tsx`, `Parties.tsx`, `Dashboard.tsx`, `Sales.tsx`, `Purchases.tsx`, `Finance.tsx`, `Reports.tsx`, all nested layout components, responsive logic, keyboard interactions, typography, icons, tables, color system, bilingual text and navigation as the references. No visual redesign by default. Specific functional changes may add necessary controls **within the existing design system**, after review.
2. Continue the pinned git submodule and a reproducible `.generated/hisabiq-web` build copy. **Never overwrite the original source UI** or silently advance its pinned SHA; adapt using versioned, reviewable integration overlays and necessary nonvisual adapter glue. When the original app has a necessary behavioral bug, propose a narrowly scoped patch and visual proof.
3. **The D1 database is the authoritative source** of business facts. Fixtures can exist in explicit design-preview routes only; authenticated live ERP routes never import seed business records into runtime transaction state. A fresh D1 must display genuinely empty counts and tables, not synthetic balances.
4. Preserve all existing Hono APIs, role enforcement, audit history, accounting and migrations as compatible contracts. Add versioned additive migrations only when existing tables cannot faithfully represent approved UI features. No migration, deploy, secret change, data copy, or reset on the production Worker or database.
5. No action may silently change cash, due, inventory, FIFO, serial ownership, return balances or vendor liabilities. The backend owns transaction validation, money precision, stock allocation, concurrent posting, idempotency and rollback; React displays intent and server results. Unsupported features stay visibly unavailable, with a reason, until the backend contract and tests are complete.
6. Keep `feat/hisabiq-react-api` / PR #9 **draft, unmerged and non-production**. Do not overwrite the user's already-working preview without a separate verified acceptance and explicit deployment approval.

## 3. Architecture approaches reviewed

| Approach | Outcome | Decision |
|---|---|---|
| Replace original pages with smaller `Live*` pages | Functional subset is quick; **visual and workflow regression** (already observed) | **Reject** |
| Send all original browser demo-store commands to existing endpoints unchanged | Shapes and transactions differ; some demo actions would falsify stock/cash or fail idempotency | **Reject** |
| **Adapter-first, backend-parity implementation** retaining original UI and migrating each business action | More careful per-feature work; matches requested design and financial safety | **Selected by the user's stated direction, subject to this design approval** |

Concrete seam: use the existing original React pages/components and state controllers; introduce typed `src/integration/contracts/` and `src/integration/adapters/` modules with explicit `load/query/mutate` operations. Replace demo-store use in the **generated integration copy**, not the pinned original, by targeted adaptations. Where existing stores are synchronous (`useSyncExternalStore`), establish an API-backed read snapshot plus *awaitable* commands; do not pretend an async server write is a synchronous preview-store update. Route change is applied only after the full page's required actions have verified backend semantics, or temporarily disable unverified actions clearly. Remove the replacement page from the primary route only when the original UI has the verified integration.

Avoid introducing an unnecessary global state framework or copying whole page files. Where source hook contracts cannot be injected narrowly, isolate a small wrapper and document why it is needed. Treat source markup and CSS as immutable regression references.

## 4. Verified repository inventory (2026-10-29)

| Original React feature/source | Existing backend evidence | Compatibility delta |
|---|---|---|
| Dashboard: `src/pages/Dashboard.tsx`, widgets/charts | `GET /api/dashboard`; stock, sales, profit, cash, debts and activity returned | Map real statistics, time series and recent transactions into existing widgets. Never show a seeded chart as actual business history. |
| Products: `src/pages/Products.tsx`, `AddProductDialog`, stock/lot/unit screens, bundle editor | `/api/bootstrap`, products catalog/edit, lots, categories, brands, units, serial/expiry/warranty endpoints | Preserve original page/tabs; actual stock, product lookups, lot-level selling, bilingual names, unit chains and bundles need faithful storage/contracts, not just basic product editor. |
| POS: `src/pages/Pos.tsx`, `CartTable`, `CheckoutPanel`, `usePosCart`, preview stores | `/api/pos/bootstrap`, sale posting, idempotency, tracking, shortage vendor/negative, receipt, cash sessions, returns | Restore **original cart and checkout UI**; define complete quote/validation and atomic posting contract for multi-unit, bundle composition, split payments, drafts/templates, installments, overrides. |
| Parties: `src/pages/Parties.tsx`, PartyDirectory/DetailAdaptive, party preview store | `/api/customers`, `/api/suppliers`, `/api/vendors`, payment/ledger endpoints | Unified Party identity, combined roles, opening balances, linked sale/purchase/finance transactions, settle/receive/pay and ledger semantics; preserve party-ledger desktop/tablet/phone layouts. |
| Sales: `src/pages/Sales.tsx`, salesPreviewStore | `/api/sales-management`, invoice detail/update, search, returns, customer receipts | Bind real invoices, edit/duplicate, payments/returns, invoice preview and source navigation; real drafts/templates and full-batch returns missing. |
| Purchases: `src/pages/Purchases.tsx`, PurchaseEditor | `/api/purchases`, supplier details/payments, purchase returns, purchase planner | Preserve original line editor and multi-unit/lot tracking; write into atomic D1 purchase transactions, fully reconcile suppliers and stock. |
| Finance/counter/daybook/reports | `/api/finance/*`, `/api/bank/*`, `/api/daybook`, `/api/reports/*`, `/api/dashboard` | Original pages currently use demo stores; wire actual cash/bank/people entries, date filters, action drill-throughs and chart series; no fabricated figures. |
| Settings, RBAC, SaaS admin previews | `/api/settings`, `/api/users`, `/api/roles`; source SaaS UI considerably richer | Map actual settings/permission contracts; separate SaaS tenancy, feature-plan control and billing into its own approved backend workstream, never imply existing single-shop D1 provides multi-tenant isolation. |

Confirmed React dependencies: `src/data/erpDemoStore.ts` states design-preview only; `src/data/salesPreviewStore.ts` seeds invoices/returns/drafts; `src/data/partyPreviewStore.ts` seeds combined people/ledgers; `src/pages/Pos.tsx` imports `data/products`, `productInventory`, `sales`, `parties`, and preview stores. Meanwhile the build integration file `scripts/prepare-hisabiq-react.mjs` *replaces* original `pos` and `products` routes with different `Live*` pages. This route replacement is the direct source of visual divergence.

Backend contract boundaries already established: `server/modules/sales/types.ts` currently accepts `qty, unitPrice, fulfillmentMode` per item but **no compound unit-chain payload or independent multi-method payments**. `server/modules/products/types.ts` has one `unit` string but **no authoritative product-specific conversion chain**, bilingual product name or bundle version. `server/modules/purchases/types.ts` stores single unit quantities and lot selling price but no complete UI mixed-unit representation. New capabilities therefore require server-side modeling and tests, not UI-only formatting.

## 5. Domain compatibility contracts to implement

### 5A. Product, stock and price
- Persist both English and Bangla names, lookup names, mandatory **short unit symbol** for each unit and product-specific conversion chains (e.g., CT → BOX → PCS) with exact integer base-unit factors. Preserve existing product/unit IDs on migration. Mixed-unit UI quantities such as `1 CT 2 BOX 3 PCS` must convert exactly to base units in POS, Purchase and Return.
- Separate default selling price from lot selling price; opening stock uses product default, purchased lot uses supplied lot price if present otherwise default, with a per-product explicit override option. Reconcile rounding, FIFO/FEFO selection and cost/price display.
- Add virtual bundle SKU/version/component definition. Sell/print as one product, atomically allocate **component** inventory and FIFO cost; negative components only with explicit policy; after sale, edits do not rewrite historical component snapshot. Full bundle return restores component inventory at the historical version.

### 5B. POS and sales
- Use the original cart, product combobox, quantities, unit/price selectors, customer/payment layout, shortage dialog, serial/expiry picker and invoice controls, preserving focus/Enter/F2 navigation and responsive row layouts.
- Define a server `quote → validate → post` contract that revalidates prices, units, stock, serial uniqueness, expiry, vendor sourcing, discounts, return eligibility and cash session on every mutation. Keep request idempotency keys and deterministic duplicate-result handling.
- Cash sales may store invoice contact name/phone without automatically creating a customer ledger party; create/link a customer only when a due/return requires it, consistently by normalized phone.
- Transactions with multiple payments must book each cash/bank/mobile amount once; manual price override must be authorized and audited. Draft/template persistence must never post stock/cash. Installment contracts, schedules and receipts require their own reviewed ledger workflow before UI actions become active.
- Returns: preserve historical unit conversion, eligible serials, partial/full invoice quantity, reviewed price adjustments, refund method, cash liquidity, COGS/lot/stock and due adjustments. Refunds require idempotent replay and no double posting.

### 5C. Unified Party and people ledger
- One cross-role identity view for Customer/Supplier/Vendor/Finance person; consolidate duplicates by explicit verified contact/identity rules, not name-only automatic merges.
- Materialize ledger entries from source transactions (invoice, purchases, payments, opening, returns, finance) with links back to canonical IDs, running balances and role-appropriate money-in/out semantics.
- Support the UI's receive/pay/settle actions and review reasons with atomic D1 movements and RBAC.

### 5D. Reports, settings, controls
- Dashboard/reports/daybook must use actual D1 source rows and include verifiable drill-through IDs; date range/date-created filters require server-consistent timezone/date semantics.
- All visible settings/roles/subscription-gated controls must be server-enforced. Store plan entitlements and a SaaS control center **only after a separate tenancy/security design**; never treat mock SaaS pages as live billing.
- All dynamic numeric and money fields use normal user-facing fonts (no monospace), with Bangla helpers and compact approved layouts unchanged.

## 6. Ordered incremental delivery and independent acceptance gates

**Slice 0 — Contract ledger and demo isolation.** Inventory every clickable original page action, seed import and data contract; classify `live read / live mutation / unavailable with reason / design-only`. Implement a default-live safety boundary: no imported seeded business data or fake transaction action on authenticated business routes. Screenshot baseline original `#/app/pos-design-preview` and `products-design-preview` as design authority. Current working API-backed POS and Products remain reachable in a separate explicit legacy-live route during migration to avoid losing posting ability.

**Slice 1 — Original Products screen live.** Connect original Products inventory table, product editor and lookup controls to existing D1 APIs through typed adapters. Preserve tables, toolbar, tabs and forms. Implement backend-first bilingual names, unit symbol/chain contracts, lot-price policies as individually audited follow-up tasks. Only enable actions with persistence proof.

**Slice 2 — Original POS screen live.** Keep the original `Pos` component and `usePosCart` user experience; connect to the proven real single-unit/serial/expiry/vendor/negative posting backend, then implement multi-unit quote/mutation semantics, split payments, draft/templates, bundles, installments **one verified vertical slice at a time**. No UI action may quietly fall back to demo posting.

**Slice 3 — Parties + Sales + Purchases.** Real unified Party directory/detail/ledger and linked Sales/Purchase flows; protect linked source transactions, editing/refunds/shortages and reconciliation.

**Slice 4 — Dashboard + Finance + Daybook + Reports.** Reuse existing D1 reporting endpoints; add missing fields and source-linked rows, keep original chart components and controls.

**Slice 5 — Settings + advanced entitlements/SaaS + acceptance.** Map live settings/user roles; implement remaining original UI workflows under explicit separate tenancy and payment security design, as needed for genuine full compatibility.

Every slice must be independently testable on **disposable local D1**. The review changes one primary route only after its original layout and all available actions pass tests. The current hosted preview is an acceptance target only when explicitly authorized; no autonomous redeploy or data reset.

## 7. Definition of done / verification

- **Visual:** screenshot comparisons of original source vs integrated UI at 390, 768, 1024, 1440 px (both modes where supported); no unapproved markup/layout replacement, no clipped tabs/columns, no monospace numeric typography. Preserve accessibility keyboard loop and WCAG 2 A/AA + 2.1 A/AA checks; audit noncritical findings.
- **Data provenance:** with an empty D1, all live business modules show empty states, never sample invoices/people/ledger/cash totals. Every displayed amount/row has a canonical API source. Design-only screens are labeled and separated so users cannot confuse them with production data.
- **Accounting:** SQL-level tests for atomic invoice + cash + bank + customer due + lot/FIFO/FEFO + serial/bundle component moves, reversals, same-request idempotency, true-concurrency stock guard and money conservation. No overpayment, duplicated refunds, invented profits or customer ledgers.
- **Permissions and errors:** unauthorized reads/writes denied by backend and hidden/disabled in UI, partial-post failures roll back, stale edits return conflict, ambiguous outcome blocks retry pending reconciliation; preserve audit actor/timestamp.
- **Deployment:** PR remains draft. CI must pass build, original UI screenshot parity, E2E against isolated D1, and all existing regressions. No merge, production/preview deployment, preview D1 migration, Worker token/secret changes or data import without user approval.

## 8. Out of scope until separately approved

Directly replacing `shererp-new` in production; migrating/copying production records; modifying the pinned source repository's UI design; implementing SaaS multi-tenant billing/plan control without tenant isolation; inventing backend behavior when demo functions don't define accounting semantics; claiming full feature parity before its test matrix is green.

## 9. Approval boundary

This document is an **architecture/design proposal**, not a claim of completed compatibility. It records the user's selection of **original HisabIQ UI as source of truth and backend-first adaptation**. Before production code changes, obtain the user's approval of this design; then write a bite-sized Superpowers implementation plan in `docs/superpowers/plans/`, with RED→GREEN tests and explicit file-by-file tasks. Begin Slice 0/1 on **draft PR #9** only. Do not merge or deploy without separate approval.
