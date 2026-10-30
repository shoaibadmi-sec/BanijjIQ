# Phase 7E3B1 — Repeated partial whole-set returns (cash-only, single bundle SKU)

**Stacked dependency:** branch targets draft Phase 7E3A PR #95 and requires Phase7E2A PR #87. Never merge directly into main while prereqs remain drafts. Existing original React POS, finance and accounting conventions stay intact.

## Scope decision
Implement only repeated **whole-set partial cash returns** for a **single-bundle-only, all-cash, undiscounted invoice**, without standalone cart products. Full-invoice cash refund remains in Phase7E3A endpoint and must keep working. This deliberately excludes a mixed-cart partial return, partial component returns, price overrides, due/bank/vendor/serial/expiry/warranty, and editing/deletion/reversal; they require a separate audited workflow.

API `POST /api/sales-returns/bundle-invoices/:invoiceId/sets` accepts exactly `{clientRequestId,reason,setsToReturn}`. `returns.add` privilege, 8–128 char key, 8–500 char reason, whole `setsToReturn>0` and `setsToReturn<remaining sets` for this endpoint. The final sets can be returned with the same route; refund is exact sets × sold unit price. Reject other keys, zero and fractional quantities, and any past full refund. Source recipe uses stored `sale_bundle_components`, not current master.

Storage via additive `migrations/0061_bundle_partial_returns.sql`:
- `bundle_partial_return_requests(request_id PK, return_id UNIQUE, invoice_id FK, bundle_id FK, sets_returned INTEGER, payload_sha256)`; multiple rows for one invoice allowed.
- `bundle_partial_return_allocations(return_id,invoice_id,visible_product_id,component_id,lot_id,source_allocation_id,movement_id,quantity,unit_cost,cost_minor)`, unique per (return_id,source_allocation_id), not global. SQL trigger enforces cumulative returned per source <= originally sold source amount, identity provenance and exact source unit cost. Master/lot CAS in one D1 batch.
- Alter only guarded insert triggers for `sales_returns`, `sales_return_items`, `cash_book` to accept matching *full* or *partial* marker in same batch; legacy flows still blocked. DB checks cannot enable direct bundle stock changes.

Allocation: for each frozen recipe component, choose original source allocations in deterministic original FIFO order, subtract cumulative allocations already restored from all prior partial/full return records, then restore exact `setsToReturn * quantity_per_set` physical base units to those original lots. Never invent a new stock lot or restore the virtual bundle. Each cash refund, return header, visible line, original-lot return record, source provenance, physical lot/master CAS and audit event must commit atomically or roll back entirely. Idempotent replay returns saved header and no writes; different request/key rejected.

Profit: certify returned lot quantities by *physical original source allocation* rather than visible bundle sets; treat per-return `sales_return_item_lots` as source cost restoration and net sales from actual paid cash refunds. Verify cumulative returned sets and source quantities, no double restored cost; no blind COGS assumptions. Expected simple three-set sale: 5 wire @20, 1 wire @30, 3 switches @5; 3 cash returns of 1 set each restore W1 (2), W1 (2), W1 (1)+W2 (1), plus one switch each. Revenue and COGS decline with each return and reach zero after third.

RED before GREEN: commit executable Hono/business transaction/profit tests, register tests in CI, observe failing test on initial head. Then minimal service and migration. Verify backend typecheck, existing 7E2/7E3A suites, reporting/POS/purchase regressions, React unchanged, Playwright a11y and real isolated Worker/D1. Draft hold until CI completed SUCCESS **and** independent accounting review. No live D1 changes or hosted deploy.

**Next distinct phase 7E3B2:** full mixed-cart bundle returns, canonical invoice reversal/void with cash rollback and audit status; then POS bundle UI enablement only after independent review.
