# Mohim ERP → BanijjIQ Hono: combined parity implementation register

**Updated:** 2026-10-28. **Target:** `shoaibadmi-sec/BanijjIQ` using Hono, Vue 3, Cloudflare D1.
**Correct primary reference:** `shuvodelux-commits/Mohim_ERP@f95be8d9bcf55b08abe8841e7502d27b23c82c4c` (2026-10-24).
**Explicit secondary reference, for optional multi-unit behavior only:** `shuvodelux-commits/sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` (2026-10-12).
**Current production:** `shererp-new` Worker, `shererp-new-db` D1. No production changes in this work.

The correct `Mohim_ERP` and the multi-unit-feature branch are **different product branches**. Functional features must be independently ported, reconciled, and tested. In particular, draft PR #2 contains **unit symbols, not the complete multi-unit system**, and is still on hold. Its code was **not** merged. The multi-unit implementation in this branch is freshly adapted from the secondary source's approved behavior, not cherry-picked.

## Current development branch: implemented and tested (NOT released)

### 1. Mixed-unit inventory / POS, first end-to-end slice

- Migration `0028_product_unit_conversions.sql` adds optional product-specific natural conversion chain and `sale_items.unit_breakdown_json` snapshot.
- `server/modules/products/units.service.ts` normalizes chains such as `1 Carton = 12 Box`; `1 Box = 20 Pcs` and proves `1 Carton + 2 Box + 3 Pcs = 283 Pcs`.
- Quantity still belongs to the **existing canonical smallest product stock unit**; no duplicate unit stock accounts, no secondary FIFO.
- Product action **Multi-unit** opens an editor. API exposes GET/PUT `/api/products/:id/conversions`, validates cycles and impossible factors.
- POS displays a compact inline quantity input for every configured unit. Server checks each posted breakdown against canonical `qty`.
- Sale posting and sale update persist base-unit quantity and the original mixed-unit snapshot; invoice and sale-edit reads expose it.
- Existing non-converted products continue using ordinary Qty.
- **Deferred**: purchase cart mixed quantities, transaction-local Price in unit, configured exact source-unit price, original purchase price reveal by selected unit, stock-view input preference, mixed-unit return cart and printed multi-unit breakdown. Do **not** claim all these complete.

### 2. Customer-first multi-invoice Sales Returns, first atomic batch slice

- Migration `0029_sales_return_batches.sql` adds `sales_returns.batch_id` as **presentation/audit metadata**, without replacing each child `return_id`.
- Search customers by ID/name/phone, inspect their linked invoices, select **2–20 distinct invoices**, at most **100 return lines**.
- New modal groups selected invoices. Each child has independent product quantity, editable price capped to its source discounted net unit price, and a shared Cash/Store Credit method.
- Each invoice's cash refund is limited to its own collected cash minus prior cash refunds. No cross-invoice cash pooling.
- Each source invoice has its own sale/return lineage, stock movements, cash-book or customer-ledger entry, and audit log. One atomic D1 batch runs after **all** child validations.
- Guarded lot restoration uses **exact source lot IDs** and a shared virtual lot/stock balance to avoid inconsistent repeated restoration across child invoices.
- **Deliberate safety limitation:** batch selections containing serial/expiry-tracked return lines are rejected. Use the existing single-invoice return path until batch tracking lineage restoration is implemented and tested.
- **Deferred:** fully editable price *above* original historical net price with mandatory reason and separately tracked expense (requested feature); end-to-end multi-unit batch return breakdown; refund mixing across payment types; financial concurrency/version checks.

### 3. Verification completed

- `npm run test:mohim-parity`: 4 integration tests passed (canonical chain, POS sale posting + invoice snapshot, invalid batch fully rejected, two-invoice atomic return and stock/ledger reconciliation).
- `tsc -p tsconfig.server.json --noEmit`: passed.
- `npm run build`: passed.
- `wrangler d1 migrations apply DB --local`: 28 total migrations passed, including 0028 and 0029; **local only**.
- Both SQL migrations executed against an **in-memory restore of the genuine production backup**, with pre/post 2 users, 9 products, 6 sales, 3 purchases, 2 sale returns, 13 sale items unchanged; integrity `ok`; no foreign key violations.
- No production D1 schema mutation, any real sale/return, or promotion of the production Worker.

## Comprehensive feature-parity backlog

References in this table are implementation files and tests in the correct `Mohim_ERP`, except multi-unit which is explicitly from the optional secondary reference. Status means **verified first-slice / missing / partial**, not release readiness.

| Priority | Feature / requirement | Source of truth | Hono status and remaining work |
|---|---|---|---|
| P0 | Virtual product bundles: independent selling price, virtual item as one cart/invoice line | `Mohim_ERP/Bundles.gs`, `tests/bundle_*.test.js`, approved bundle spec | **Missing**. Build bundle master + recipe revisions and FIFO consumption per component |
| P0 | Bundle stock: component-only stock movement, negative component availability allowed | Same | **Missing**. Atomic sale + reversal and report-cost tests |
| P0 | Bundle edit, duplicate, sale return, full-bundle return only, historic version | Same | **Missing**. Historical recipe snapshots, no per-component return |
| P0 | Batch return customer-first invoice picker, 2–20 unique invoices | `Mohim_ERP/SalesReturn.gs`, `tests/multi_invoice_sales_return_regressions.test.js` | **First slice implemented**. Serial/expiry cases and advanced returns pending |
| P0 | Batch return atomic child posting; source-specific cash capacity and Store Credit | Same | **First slice implemented**. Concurrency/rollback/ledger allocation hardening required |
| P0 | Editable single/batch return price; source net-price reset | `Mohim_ERP/returns.html` and secondary approved user direction | **Partial**. Current batch price limited to original discounted price. Above-source variance as expense pending |
| P0 | Mixed-unit products: Gauge/Gira, Pipe/Feet, Carton/Box/Pcs | **Secondary** `sherERP_Mohim/ProductUnitConversions.gs` and its approved specs | **First slice implemented** for product config + POS + invoice snapshot. Other transaction modules pending |
| P0 | Exact unit-specific purchase/selling price, Price in selector | Secondary `PROJECT.md`, unit tests | **Missing**. Avoid lossy price round-tripping |
| P0 | Multi-unit Purchase / Returns / Drafts and original unit snapshots | Secondary unit conversion design | **Missing**. Same canonical stock engine and source history |
| P0 | Whole-Taka final-payable rounding and audited adjustment | Secondary `PROJECT.md`, `Sales.gs`, `sales_final_rounding.test.js` | **Missing**. Reconcile paid/due, invoices and profit reports |
| P0 | Customer phone identity/duplicate checks, Walk-in credit conversion | `Mohim_ERP/Customer.gs`, `CUSTOMER_IDENTITY_DRAFT_FIX_REPORT.md` | **Partial**. Review customer creation currently outside D1 batch and ambiguity handling |
| P0 | Sale & Purchase edit/delete reversible stock, FIFO/ledger, audit | `Mohim_ERP/SalesManagement.gs`, `PurchaseManagement.gs`, `DeleteEngine.gs` | **Partial**. Add cross-module invariant tests |
| P1 | Independent Finance Person Ledger, two-pane desktop and mobile list-first | `Mohim_ERP/financePersonLedger.html`, `FinanceModule.gs`, finance person tests | **Missing** dedicated UI and role-specific signed balance read models |
| P1 | Finance person transaction view/edit/delete in modal and keyboard search | Same | **Missing**. Reuse authorized transaction endpoints, not duplicate money writes |
| P1 | Semantic ledger colors and credit-first labels (জমা/খরচ) | `Mohim_ERP` Oct 24 ledger changes, `docs/erp-semantic-balance-card-audit.md` | **Partial**. Must audit real cash direction before color changes |
| P1 | Supplier searchable purchase selection + current due balance | `Mohim_ERP/purchase.html`, `tests/purchase_supplier_balance_combobox.test.js` | **Missing** exact combobox behavior |
| P1 | Draft sale POS V2 re-open, edit, duplicate and audit | `Mohim_ERP/DraftSales.gs`, draft tests | **Missing** durable draft API/table |
| P1 | POS V2 only for edit/duplicate/sale reprint/return entry | `Mohim_ERP/posv2.html`, `tests/pos_v2_only_sales_workflows.test.js` | **Partial**. Unify all entry points; ensure full data restoration |
| P1 | Cash-session opening baseline vs cash/bank ledger, reconciliation | `Mohim_ERP/CashReconciliation.gs`, `tests/historical_opening_cash_baseline.test.js` | **Partial**. Add opening/cash session tests |
| P1 | Multi-role finance people: owner/lender/borrower receivable/payable | `Mohim_ERP/FinanceModule.gs`, `tests/finance_person_ledger_*.test.js` | **Partial**. Signed direction & source reference consistency |
| P1 | Customer/Supplier settlement discount | `Mohim_ERP/SettlementDiscount.gs`, `CustomerSettlement.gs`, `SupplierSettlement.gs` | **Missing** dedicated discount entries; ledger reconciliation required |
| P1 | Return ledger hotfix & supplier/party due consistency | `Mohim_ERP/RETURN_LEDGER_HOTFIX_REPORT.md`, ledger tests | **Partial**. Audit all source linkages and display amounts |
| P1 | Vendor shortage/consignment and returns | `Mohim_ERP/Vendors.gs`, vendor tests | **Partial**. Check negative stock, vendor payable, refunds |
| P1 | Internal Stock Lot Cost Correction, exact-lot audit trail | `Mohim_ERP/StockLots.gs`, `STOCK_LOT_COST_CORRECTION_REVIEW.md` | **Missing** correction management |
| P1 | Owner/lender/borrower loan/repayment and finance journal direction | `Mohim_ERP/FinanceModule.gs` | **Partial**. Reconcile signed balances |
| P1 | Day Book read/write + created date vs transaction date | `Mohim_ERP/DayBook.gs` | **Partial**. Historical consistency |
| P2 | POS keyboard-first Enter loop and compact cart | `Mohim_ERP/posv2.html`, POS tests | **Partial**. Improve focus after mixed-unit input |
| P2 | Product/source search and newest-first master sorting | `Mohim_ERP` master list tests | **Partial**. UX follow-up |
| P2 | No monospaced financial typography | `Mohim_ERP/tests/no_monospace_typography.test.js` | **Missing** cross-ERP cleanup |
| P2 | Semantic KPI cards: dues, income, cash, profit | `Mohim_ERP/docs/erp-semantic-balance-card-audit.md` | **Partial**. Source-ledger checked color semantics |
| P2 | Reports link to source invoice/product/party and business advice | `Mohim_ERP/Reports.gs`, reporting tests | **Partial**. Formula parity and source navigation |
| P2 | Targeted business-data clear with allowlist and preserved audit IDs | `Mohim_ERP/DeleteEngine.gs`, data-reset tests | **Missing**; never add destructive reset without extensive testing |
| P2 | Synthetic demo seed protected from production D1 | `Mohim_ERP/SeedData.gs` | **Missing**; use isolated test DB only |
| P2 | Permission-specific confirmations, audit and backdated controls | `Mohim_ERP` confirmation & auth tests | **Partial**. Add role matrix regression |
| P2 | Responsive tablet/phone Finance, POS, Party, Expense | `Mohim_ERP` responsive tests | **Partial**. Device tests required |

## Follow-up pull requests, in release-safe order

1. **This development PR**: reviewed mixed-unit POS + initial atomic batch returns; do not merge until real UI/device review, cash session and permissions regression coverage, and source edge-case agreement.
2. **Bundles**: independent bundle master/version/recipe, component FIFO with single visible invoice line and complete return/reversal.
3. **Finance Person Ledger**: dedicated split workspace, signed person balances and modal actions.
4. **Accounting reconciliation**: full tracked batch returns, customizable above-net price adjustment as expense, cash eligibility, returns by multiple units, settlement discount.
5. **Purchase and pricing parity**: multi-unit purchase cart, exact Price in unit, final sale rounding, cash/bank/card transaction invariants.
6. **Workflow/UI parity**: POS V2 drafts & keyboard, searchable supplier due, semantic ledger labels, reports, no-mono typography, mobile/tablet.

## Before ANY production promotion

1. Keep PR draft, check tests on GitHub and real preview on isolated nonproduction D1. Never run preview write tests against real D1.
2. Take a fresh private export of live `shererp-new-db` and verify restore plus actual table/column/cash/stock checksums.
3. Migrations `0028` and `0029` must be reviewed and applied **to a test clone first**; production needs them *before* the corresponding new Worker version is promoted.
4. Test both single-invoice and batch returns (including deliberate failure of last item), POS sale/edit/reprint, inventory FIFO and negative stock, finance and permissions.
5. Keep Cloudflare Builds `npx wrangler versions upload` (inactive only) until explicit production release authorization.
6. Block automatic promotion; customer records, invoice amounts and existing D1 migration history must remain unchanged unless an approved transaction is performed.
