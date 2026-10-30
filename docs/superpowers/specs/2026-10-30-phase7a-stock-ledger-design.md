# Phase 7A — Source-Backed Stock Ledger (30 October 2026)

## Intent
Give shopkeepers an authenticated, inspectable stock history and independently reconciled current quantity for each product. Never invent missing movement records or claim historical stock valuation from a current snapshot.

## Chosen design
Reuse the existing products, stock_lots, and stock_movements D1 tables and existing products.view RBAC. Add a read-only GET /api/products/:productId/stock-ledger?page=1&pageSize=50 endpoint, with 50/100 pagination ordered by immutable movement row ID (stable when timestamps tie). Keep existing /history behavior and HisabIQ React UI unchanged.

## Accounting contract
- Current master stock must agree independently with the sum of surviving FIFO lot quantities and the sum of recorded movement quantity_in minus quantity_out.
- Latest movement's stored balance_after must agree with the current master; do not demand each individual movement's balance_after be sequential because multi-lot POS writes multiple same-final-balance movements per invoice.
- Validate finite, nonnegative, four-decimal source quantities and safe four-decimal reconciliation arithmetic. Negative or oversold stock is needs-review, not silently normalized.
- Missing movements, source mismatch, invalid data, or capped history are needs-review. Never mutate source records to make a reconciliation pass.
- This is quantity reconciliation, NOT historical valuation or a proof that every old sale is complete. Status 'ready' means the listed quantity invariants match recorded data, not an external physical stock count.
- Request must be authenticated and products.view-gated; invalid page or size gets HTTP 400; missing/deleted product 404.
- Only local disposable SQLite/D1 fixtures in tests. No new database migration, remote database writes, cloud deployment, or merge without evidence.

## Alternatives rejected
1. New stock ledger table: duplicates movements already recorded in transaction writers; unsafe until source writers unified.
2. Rewrite existing /history API: breaks existing React consumers.
3. Chosen: additive read-only endpoint with fail-closed reconciliation, least surface area.

## Separate acceptance
Business logic tests: 2 FIFO sources, multiple sale rows per invoice, source corruption, missing history, invalid quantities, stable pagination, and proof that reads do not mutate D1.
API route tests: authentication, products permissions via shared RBAC, validation, missing product, and read-only HTTP contract.
Full CI: npm run test:phase7, all existing Phase 3/4/5/6 gates in branch context, backend build, React build, isolated Worker/D1, Playwright and axe where configured.

## Out of scope
Manual stock corrections, FIFO costing changes, damaged stock, bundle stock consumption, new UI, production deployment, and altering upstream Phase 3–6 draft branches. Those are later tasks 7B–7G.
