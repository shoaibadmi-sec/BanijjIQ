# HisabIQ_UI as the React ERP frontend — direct API integration contract

Approved scope: **reuse the original HisabIQ_UI components** (Dashboard, POS, combined Party Ledger, Products table, underlined tabs, 36px controls, bilingual help and blue theme). Use the BanijjIQ Worker/D1 API for real transactions. Mohim_ERP is the workflow reference for Finance, Add Product, Product Actions and Sales Management; do not port or mix Vue.

## Source control and first vertical slice

- UI source is the actual `shuvodelux-commits/hisabiq_ui` git submodule, updated to merged UI PR #216 (`0389b179`) for joined multi-unit quantity fields, short symbols and one-row tablet carts. Do not edit or overwrite its source while adapting it.
- POS Cart is the upstream `src/components/pos/CartTable.tsx`, used by the API-backed `/app/pos`. The build-time overlay only adds live catalog, symbol, source-shortage and tracking callbacks. It preserves the source JSX; upstream changes must fail closed until reviewed.
- Real catalog and stock come from `/api/pos/bootstrap`; serial options come from `/api/pos/products/:id/tracking-options`; source vendor and stock shortage use existing validated API workflows. The original cart's user-entered whole-number mixed quantities are converted to the backend base quantity using the immutable revision. No demo product, invoice, stock lot or payment account is used for financial posting.
- The posted checkout remains the already integrated `LiveCheckoutPanel` and `/api/pos/sales`, including server-generated invoices, cash-session validation, duplicate-request protection, FIFO, refunds and back-end permissions. **This is not yet source-identical CheckoutPanel.** Do not switch to the demo CheckoutPanel until real split payments and settlement contracts exist.
- Unavailable purchase unit-cost data must not be represented as BDT 0; the source cost-eye is disabled in live mode. Multi-unit prices are taken from the backend profile and cannot be overridden by a UI-only field.

## Remaining functional work (implement per-module, strict RED → GREEN)

| Priority | Approved original frontend | Current API / backend work still needed |
| --- | --- | --- |
| 1B | Source `CheckoutPanel` and POS Drafts/Templates | Integrate real customer balance, split/multi-row payments, invoice rounding, selected customer due, drafts and settlement; add or extend backend routes with idempotent ledger postings and rollback tests before UI enablement |
| 2 | Source Dashboard and combined Party Ledger | Replace `erpDemoStore`/sample ledger reads with authenticated D1 summaries, customer/supplier account ledger, invoice drill-down, 50/100 pagination and source-linked date filters; preserve exact existing UI |
| 3 | Source Sales Management / Mohim actions | Live invoice lists, receipts, returns, cancellation and authorized audit; batch cross-invoice returns and accounting reversals require positive and negative transaction tests |
| 4 | Original Products table and Mohim Add Product | Move patched table fully to API data; wire safe inline catalog edits, column settings, serial/expiry/warranty/lot controls and source-linked stock value; never mutate FIFO history in a catalog edit |
| 5 | Mohim Finance and Party-like Daybook | Reuse approved compact financial layouts, current Phase 6 APIs; prevent anonymous/draft/deleted entries from appearing as posted; source-linked journal and reconciliation drill-down |
| 6 | Purchase, vendors, bundles, installment | Preserve original purchase editor; audit existing backend coverage against mixed-unit returns, component-level bundle FIFO, source-based refunds, installment loan/collection plans before exposing unsupported actions |

## Release gates and limitations

1. Test the adapter and patched source components against the exact pinned UI SHA, then React/Vite, real POS worker/D1 integration, keyboard and tablet Playwright at 390/768/1024/1440 widths.
2. Test original quantities (single, 2, 3 and 4 units), serials/expiry/warranty, insufficient stock, vendor/negative, price override, duplicate click/network timeout and multi-tenant RBAC. Only successful server responses may finalize sales.
3. The current source `Dashboard`, `Parties`, `Sales` are still preview/demo-facing and must not be presented as fully migrated live modules. Existing `LiveCheckoutPanel` is an interim API-safe checkout—not an exact original UI component. Do not claim total UI parity.
4. Frontend tsconfig currently reports 8 unrelated existing errors in Reports and Purchase Return unused imports; clean them on their own regression-tested branch before strict full frontend typecheck gating.
5. Do **not** merge Phase 6 PR #28 or this stacked UI branch until GitHub CI, D1 integration, browser checks and independent finance/reconciliation acceptance are completed. Never apply finance migrations to a shared production or demo database while assessing UI.
