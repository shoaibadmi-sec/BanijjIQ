# Mohim ERP → BanijjIQ Hono parity audit and implementation roadmap

**Audit date:** 2026-10-28 (Bangladesh). **Status:** audited; phase 1 implemented on an isolated branch, NOT released.
**Authoritative behavior reference:** private GitHub `shuvodelux-commits/sherERP_Mohim` at commit
`590adfad128fe7155bfb7b608a2ed5665b202a9c` (2026-10-12).
**Target:** `shoaibadmi-sec/BanijjIQ` (`shererp-new` Worker, Hono + Cloudflare D1, Vue 3)
based on GitHub commit `e5825b3219201c67e4ad1574c5f6e9f2c2a6830e`.
**Important:** the Apps Script/Sheets schema is NOT the D1 schema. Functional parity requires deliberate
API, data-model, accounting, rollback, UI and test design; copy/paste is not a port.

## Evidence examined

- Latest Mohim GitHub history, especially PRs #35–#44 and September 2026 feature commits.
- Mohim `PROJECT.md` sections 5–16, 20 and addenda dated September 21–29;
  `MULTI_INVOICE_SALES_RETURN_V2_REVIEW.md`,
  `CUSTOMER_IDENTITY_DRAFT_FIX_REPORT.md`,
  `STOCK_LOT_COST_CORRECTION_REVIEW.md`,
  `BUSINESS_FINANCE_MULTIBALANCE_UPGRADE_REPORT.md`,
  `RETURN_LEDGER_HOTFIX_REPORT.md`,
  `AUDIT_REPORT.md`, `FINAL_PRODUCTION_AUDIT_REPORT.md` and 115 `tests/*.test.js` files.
- Hono routes/services in `server/modules/{sales,purchases,products,customers,finance,reporting,admin,auth,vendors,expenses}`,
  Vue components and all 26 existing D1 migration files.
- **Production evidence:** original D1 has 26 migrations through `0027_supplier_warranty_rma.sql`.
  Owner-only local SQL export was restored in-memory, with 54 app tables, valid integrity, no foreign-key
  violations, and non-sensitive record-count baseline 2 users / 9 products / 6 sales / 3 purchases.
- No production schema or business transaction was changed during this parity work.

## Feature-difference matrix

Legend: **Missing** = no equivalent behavior found; **Partial** = API/UI or simplified
equivalent exists, but Mohim invariants are not fully covered; **Existing** = broad module present
(the exact workflow still needs regression verification).

| Priority | Mohim update / invariant | Mohim source evidence | BanijjIQ status | Port strategy / acceptance gate |
|---|---|---|---|---|
| P0 | Multi-unit conversion: smallest/base unit canonical, mixed `1 Gauge 2 Gira`, Box/Pcs, Pipe/Feet; stock/FIFO unchanged | `ProductUnitConversions.gs`, `Products.gs`, `posv2.html`, `purchase.html`, `PROJECT.md §20` | **Missing** conversion schema & cart | Add product-specific conversion graph and exact base-unit normalization. Test round-trip conversions, FIFO, stock reconciliation, returns and refunds before shipping |
| P0 | POS transaction-local **Price in** unit; preserve exact configured unit purchase/sell price, no rounded converted price multiplied back | Mohim PR #38–40; `PROJECT.md` Sept 29 | **Missing**; Hono POS lines have one `unitPrice` and one `unit` | Persist exact source-unit price and chosen unit; canonicalize after input. Test UI draft/edit/duplicate/invoice reload and supplier cost visibility |
| P0 | Stock View, Opening Stock input unit and Minimum Stock input unit are independent preferences | `Products.gs`, `PROJECT.md §20`, stock view tests | **Missing**; stock fields are single numeric quantities | Add stored preferences while quantity always remains canonical; changing selectors must convert visible quantity rather than reinterpret it |
| P0 | Whole-Taka final sale rounding, `Rounding Adjustment` ledger/invoice state; .50 goes up | Mohim PR #39–40, `Sales.gs`, `SalesManagement.gs`, `Invoice.gs` | **Missing** dedicated adjustment | Design exact decimal calculation end-to-end before migration. Reconcile sales totals, payments, due, draft, update, print and finance ledgers |
| P0 | Native transaction edit/delete and accounting reversals with audit, strict rejection before writes | `PROJECT.md §20`, `SalesManagement.gs`, `PurchaseManagement.gs`, `DeleteEngine.gs` | **Partial** | Formal reversal matrix, transaction atomicity via D1 batch and referential tests. Do not replay Apps Script's manual rollback logic |
| P0 | Customer-first multi-invoice Sales Return batch, unique source invoice for each child, no cross-invoice cash refund pooling | `MULTI_INVOICE_SALES_RETURN_V2_REVIEW.md`, `SalesReturn.gs` | **Partial** individual returns; no verified equivalent 2–20 invoice batch | Child return per original invoice; validate full set first; invariant tests for cash/store-credit, quantities and lot restoration |
| P0 | Editable return price on all returns, source net-price reset affordance, reason + price variance in separately tracked adjustment | `MULTI_INVOICE_SALES_RETURN_V2_REVIEW.md`, `returns.html`, `PROJECT.md §20` | **Partial / requires API audit** | Separate return-price overrides from original invoice economics; reason & audit; clearly report difference as expense |
| P0 | Customer identity repair: deterministic phone/ID linkage, draft posting, reject ambiguous customer matches | `CUSTOMER_IDENTITY_DRAFT_FIX_REPORT.md`, `Customer.gs`, `DraftSales.gs` | **Partial** | Confirm stable ID linking, walk-in return auto-creation, historical phone matching, ambiguity and stale-ID cases |
| P1 | Durable Sales Drafts, complete POS resume/update/duplicate, audit/history | `DraftSales.gs`, `draftSales.html`, `DRAFT_INVOICE_UPDATE_STATUS.md` | **Missing** first-class draft table/API | Draft owns exact cart/customer/units/payments/notes; live sale posted once; idempotent duplicate and delete audit |
| P1 | Internal opening/adjustment stock-lot cost correction with audit, exact lot ID only | `STOCK_LOT_COST_CORRECTION_REVIEW.md`, `StockLots.gs` | **Missing** explicit correction/audit workflow | Correct eligible internal lots and exact sale-item-lot cost links only. No change to revenue, stock qty, cash or balances |
| P1 | Customer/Supplier Settlement Discount, correct ledger and receivable/payable adjustment | `SettlementDiscount.gs`, `CustomerSettlement.gs`, `SupplierSettlement.gs` | **Missing** explicit discount transaction | Post auditable settlement rows; test allocation and no cross-invoice misapplication |
| P1 | Cash-session reconciliation including opening differences and controlled close | `CashReconciliation.gs`, `CashSession.gs`, `cashReconciliation.html` | **Partial** cash sessions exist | Verify expected/actual book, inventory of payment methods and reversible adjustments |
| P1 | Finance persons multi-balance, debt direction, ledger read semantics, Day Book consistency | `BUSINESS_FINANCE_MULTIBALANCE_UPGRADE_REPORT.md`, `FinanceModule.gs`, `DayBook.gs` | **Partial** finance, Day Book modules exist | Transaction types and balance directions must reconcile across all entry points and reports |
| P1 | Vendor shortage/consignment supplier and returns, negative stock accounting | `NET_STOCK_VENDOR_SHORTAGE_FIX_REPORT.md`, `Counter.gs`, `Vendor.gs` | **Partial** vendor/shortage routes exist | Test independent stock, vendor payable, source linkage and partial return settlement |
| P1 | Confirmation matrix for destructive/financial operations | `confirmation_spec_matrix.test.js` and related tests | **Partial** | Codify permission, reason, irreversible-action confirmation and effective-date rules with integration tests |
| P1 | Optional unit symbols, immutable canonical unit name and full-name fallback | Mohim PR #37, `PROJECT.md` Sept 29 | **Phase 1 implemented in this PR** | Migration `0028_unit_symbols.sql`, service and POS UI; test edit never affects unit name or stock |
| P2 | Inline debit/credit direction markers | Mohim PR #44, `financeLedger.html` | **Phase 1 implemented in this PR** | Semantic red ↓ money-out / green ↑ money-in, unchanged exported ledger data |
| P2 | Keyboard-first POS Enter loop and combobox accessibility | Mohim PR #40, `posv2.html` | **Partial** product search already has keyboard support | Add next-line focus and unit controls without breaking existing compact cart behavior |
| P2 | Realistic seeded demo business, with production protection | `SeedData.gs`, Mohim PR #41 | **Missing** | Test-only isolated D1 seeder; NEVER seed the already populated production D1 |
| P2 | Targeted clear data allowlist, preserve IDs and security/audit history | Mohim PR #42, `PROJECT.md` Sept 29 | **Not ported** | Do not introduce global destructive reset; explicit approved table allowlist and staged backup/restore tests |
| P2 | Report decision assistance, source drill-down, supplier/customer/product insight | `Reports.gs`, `reports.html`, `AUDIT_REPORT.md` | **Partial** reporting routes and Vue exist | Compare metrics against ledger source rows; add business-oriented insights after calculation parity |

**Caution:** *Existing* and *Partial* are static-review classifications, not production certification.
Some Mohim notes document intentions, isolated work or tests; they are not evidence of a clean,
fully deployed production release. The source commit is the fixed reference for this audit.

## Implementation sequence and dependency boundaries

1. **Phase 1 (this PR, isolated):** unit symbol metadata/API/UI + compact finance direction indicators.
   Additive `0028_unit_symbols.sql`; no quantity, price, or ledger accounting changes.
2. **Phase 2 (P0 inventory core):** conversion profiles, exact source-unit prices, Stock View/input preferences,
   mixed-unit purchase and POS lines, authoritative base-unit normalization. This is foundational for returns.
3. **Phase 3 (P0 sales & finance):** whole-taka sale rounding, due split/ledger compatibility, discounts,
   cross-invoice return batching and editable return price with audit expense, strict reversal tests.
4. **Phase 4 (P1 operations):** robust drafts and phone identity, cash reconciliation, finance multi-balances,
   customer/supplier settlements, vendor shortage logic, cost correction, system audit.
5. **Phase 5 (P2 interface and insights):** keyboard loop, report drill-down/decision guidance,
   optional test-only demo seed and allowlisted clear. Keep compact bilingual UI from the target design.

## Phase 1 tests and deployment gates

- `npm run build` (Vue/Vite frontend typecheck + production compile).
- `tsc -p tsconfig.server.json --noEmit` (Hono / D1 TypeScript).
- GitHub Actions `.github/workflows/mohim-parity.yml` runs all type/build/parity checks and ephemeral Cloudflare local D1 migration on every PR.
- `npm run test:parity` (in-memory fresh SQLite migrations, unit symbol add/edit/list,
  original-name and stock invariants, POS display-unit data, invalid rename rejection).
- `0028_unit_symbols.sql` separately tested against a **temporary in-memory restore**
  of the existing private production SQL backup. Business row counts unchanged; SQLite integrity `ok`.
- No production migrations or GitHub `main` merge from this PR. Existing deployed Worker
  remains healthy; new feature requests will fail against old schema until migration 0028 is applied.
- **Before promotion:** take a new D1 export, test migration on isolated D1 clone, apply only migration
  0028 after review and only when rollout approved. Confirm the existing 26 migrations remain untouched,
  check `PRAGMA table_info(product_units)`, then smoke test actual Hono routes. Keep a rollback plan.

## Non-negotiable engineering invariants

- D1 is canonical for production business records; no dual writes to Google Sheets.
- Product Unit `name` is stable identity; symbol is optional display metadata only.
- All unit quantities, stock lots, FIFO costing, purchases and returns must reconcile in canonical base units.
- Keep exact source money/price values; calculate rounding precisely at the final payable boundary only.
- Each returned line must retain source invoice and original net-price provenance.
- No invoice/payment/ledger double-posting; every action is permission checked and audited.
- Never rewrite/seed/clear production data to force a test to pass.
- Cloudflare Builds should keep `npx wrangler versions upload` (inactive version) until approval;
  unit-symbol D1 migration MUST precede promoting the feature-bearing release.
- Separate validation of source code, database schema, actual stored data and live UI; tests must
  include successful and rejected flows. Production decisions require verification, not assumptions.
