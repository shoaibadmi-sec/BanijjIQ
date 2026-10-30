# Phase 7E3A — Full-invoice cash bundle returns with original FIFO restoration

**Stack:** branch `feat/hisabiq-phase7e3a-bundle-cash-returns-tdd` on draft Phase 7E2A branch `feat/hisabiq-phase7e2-bundle-cash-posting-tdd` (PR #87), not directly on main. No assumption that 7E2 is merged.

**Problem:** Bundle invoices show one virtual SKU while consuming physical component FIFO lots. Standard return/delete flows would restore virtual product stock, corrupt FIFO COGS, or post cash movements outside a single atomic transaction. Phase 7E2A intentionally blocks those workflows.

**Release-safe incremental scope:** Phase 7E3A handles exactly **one complete cash refund of every visible line on a single guarded cash bundle invoice**. It is not a general partial bundle return. The existing POS UI remains unchanged, bundles remain hidden, and legacy mixed-unit/standard returns remain untouched. This slice is a prerequisite for later partial full-set returns and editable/cancellable invoices.

**API:** `POST /api/sales-returns/bundle-invoices/:invoiceId` requires `returns.add`, positive `reason`, unique 8–128-character `clientRequestId`, and open cash session. Accepts no custom return prices, quantities, payment methods, or backdating. Read sold invoice, all immutable `sale_bundle_components`, `sale_items`, `bundle_sale_allocations`, `sale_item_lots` and source stock_lots. Full return amount exactly original invoice paid cash. Response `{ok,returnId,invoiceId,refundAmount,costMinor,replayed}`.

**Database:** additive `0060_bundle_cash_full_returns.sql` for `bundle_cash_return_requests` unique by invoice and request key (fingerprint), plus immutable `bundle_return_allocations` referencing original source allocation, return movement and actual restored qty/cost. Relax only the two return INSERT triggers from 0059 **when** the exact invoice has a marker in `bundle_cash_return_requests` inside the same D1 batch. Other sale editing/delete/reversal triggers stay active. No data deletion.

**Accounting invariants:**
- The cash-book refund debit exactly equals original full cash paid; no duplicate refund or duplicate receipt.
- All physical source lot remaining quantities restored **to original lots**, never to bundle virtual stock, with source-level historical cost and exact immutable per-source quantity; no stock variance or product ID substitutions.
- Any merged physical demand from same-cart ordinary lines is also reversed in full, without double counting.
- Master stock and lot snapshots checked at execution time inside D1 atomic batch with conditional CAS; 409 + no partial writes if another sale or purchase changes balances.
- FIFO stock movements record genuine per-lot running balances, not final aggregate.
- Insert `sales_returns`, `sales_return_items`, `sales_return_item_lots` for existing profit reporting. Extend live profit audit only as needed to validate bundle recipe and original source restoration; net Sales and COGS become zero after complete return.
- Sale invoice remains immutable with its original receipts/sale lines; return is a separate compensating cash transaction. Avoid `sales.status='Reversed'` until canonical reversal journal and comprehensive invoice-cancellation engine in Phase 7E3B.
- Reject invalid/raced/duplicate different request IDs, nonexistent/non-bundle/partially returned/due/bank/tracked invoices, zero/no original acquisitions, stock lot capacity overflow.
- Standard `/api/sales-returns` and `/api/sales-management/:id` must continue to block bundle lifecycle.

**Execution:** Strict Superpowers TDD RED→GREEN and Ponytail. Commit authenticated Hono, migrated SQLite business/transaction/profit/RBAC tests first. Confirm RED on exact SHA in GitHub CI (or authorized local workspace). Add minimal 0060 migration, one isolated service and route. Validate exact-head backend/accounting regressions, React build, Playwright/a11y and real isolated Worker D1; keep draft unless CI green and independent accounting review. No production migration/deploy or manual mutation.

**Next Phase 7E3B:** Partial whole-set bundle returns and original-lot proportional allocation across multiple returns, invoice reversal/audit status and cash-session availability/caps, complete mixture of due/bank/vendor, eventually POS enablement.
