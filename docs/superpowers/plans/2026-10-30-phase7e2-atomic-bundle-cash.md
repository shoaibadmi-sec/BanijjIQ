# Phase 7E2A — Guarded cash-only virtual bundle posting (TDD plan)

**Goal:** One visible cash invoice line per virtual bundle, source-backed FIFO component depletion and cost, guaranteed atomic and idempotent, while all incomplete bundle sale lifecycle mutations are *blocked*.

**Architecture:** Build on current React main, NOT old Vue/stacked bundle PRs. The existing POS checkout and UI stay unchanged. New restricted API routes support saved versioned bundle recipes and a separate guarded cash-only bundle sale. No PWA feature flags exposed. Use one D1 transactional `db.batch` for invoice, receipt, physical product/lot CAS, immutable snapshot and source-cost attribution. Use existing `sales`, `sale_items`, `sale_item_lots`, `stock_movements`, `pos_sale_requests`, `cash_book`, `audit_logs`. Add only versioned recipe + invoice component source tables via additive migration.

**Boundary:** CASH only; no Due/Partial/Bank/Mobile, Vendor Sourcing, negative stock, tracked/warranty/expiry components, unit conversion, invoice discount, backdating, returned/cancelled/edited bundle invoices. No UI navigation to bundles or general POS bootstrap. Build complete return/reversal in Phase 7E3; DB triggers prevent financial corruption before then.

**Endpoints**
1. `POST /api/products/bundle-recipes` — Products.add; creates a virtual bundle product with independent sell price, positive whole-unit components and revision 1. Validates physical standard components.
2. `POST /api/pos/bundle-sales` — POS.add; body `PosSaleInput` with `clientRequestId`, `customerName`, `customerPhone`, `paymentType:'Cash'`, `paymentMethod:'Cash'`, `items`. Supports mixed bundle + standalone Standard lines; all quantities whole base units, no discount; verifies recipe revision + FIFO sources.
3. Ordinary `POST /api/pos/sales` must reject virtual bundles, rather than decrementing a fictitious virtual stock balance.

**Business invariants**
- Bundle receipt/invoice lists the bundle as a single item; component items never appear as customer-facing sale rows.
- Single per-product FIFO lot cache across full cart. Each original physical lot consumed at most once; every draw attributed to one visible parent. Snapshot recipe revision and quantities per component permanently in `sale_bundle_components`. Physical allocations in `bundle_sale_allocations`.
- Sale item lot `product_id` is visible parent, so reporting retains original-cost COGS under bundle revenue, never phantom component sales. Original cost per lot; safe integers in poisha.
- Cash receipt posted exactly once with invoice; no customer ledger, bank, supplier or vendor writes.
- Product and FIFO lot optimistic CAS with stale snapshot refusal, D1 all-or-nothing. Same request key + identical JSON returns original invoice; changed body/key returns 409.
- DB triggers prevent all bundle invoice sales updates, sale_items mutation and return creation until Phase 7E3; no destructive old POS/return flow can corrupt bundle source stock.
- Recipe immutable for posted invoice; a future revision must never rewrite older snapshots. No hosted/production D1 changes.
- Standard React POS design preserved and bundles hidden from bootstrap.

## TDD execution
1. Write real authenticated Hono/business and transaction/RBAC test suites using fully migrated local D1-compatible SQLite. Commit *tests before production code*, add npm scripts and required GitHub Actions gate. Capture expected RED (missing route).
2. Add migration `0059_bundle_atomic_cash.sql`, versioned recipe service, cash sale posting service, guarded routing. Minimal code only.
3. Locally verify backend/finance/Product/POS regression tests and Worker/D1; exact-head full GitHub CI must complete SUCCESS. Independent accounting and migration review required. Leave DRAFT, do not merge/deploy or enable React POS.
4. Follow-up Phase 7E3: complete-set return, cash refund and invoice reversal with historical lot/restoration provenance before enabling the UI.

Use superpowers RED→GREEN/verification and Ponytail; keep UI unchanged, no new dependency.
