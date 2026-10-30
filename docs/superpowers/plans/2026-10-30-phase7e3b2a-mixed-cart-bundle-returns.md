# Phase 7E3B2A — Partial whole-set bundle returns on mixed carts

**Stack**: Draft PR #97 (Phase 7E3B1) is the base; its parent PR #95 depends on #87. Use an isolated branch. Keep React UI identical. No hosted D1 deployment, no production migrations.

## Strict scope and invariants
Extend the existing authenticated `POST /api/sales-returns/bundle-invoices/:invoiceId/sets` endpoint so that an invoice with **exactly one saved virtual bundle SKU plus one or more ordinary, untracked Standard SKUs** can return whole sets of that bundle without returning, repricing, or modifying the ordinary SKU lines. This is *not* a generic mixed-cart return interface; ordinary-line returns and multi-bundle returns remain blocked until the next audited slice.

Preserve existing strict CASH-only invoice, no discounts/due/backdating, no vendor/negative/mixed-unit/tracked items, open cash session, Returns.add RBAC, request fingerprint/idempotency and original source-lot CAS. The incoming body still accepts only `clientRequestId`, `reason` and integer `setsToReturn`.

1. Validate **all** visible sale items: one Bundle, all others Standard; no duplicate product IDs, all original quantities/prices exact, sum of *all* original `line_total` equals original sale `grand_total` (integer poisha). Bundle total is `bundleSets * bundleUnitPrice`, but does **not** need to equal grand total.
2. Check saved immutable recipe for that Bundle and verify `bundle_sale_allocations` for *every* visible invoice line: each physical source lot belongs to its expected visible parent. Bundle returns allocate **only** the subset whose `visible_product_id` matches the bundle line. Same-product standalone lot allocations stay sold and costed, never added back.
3. Return exactly `setsToReturn * originalBundleUnitPrice` cash; previous refund sum equals the prior bundle-set refunds (ordinary line cannot be independently returned in this slice). Both the already-paid cash receipt and total spent across retries must stay consistent.
4. Restore original physical component lots in order, using remaining unreturned amounts of only bundle source allocations. The existing `bundle_partial_return_allocations` lifetime trigger and D1 atomic batch remain unchanged, preventing duplicate restoration or partial money writes.
5. Profit reporting must remain **ready**, showing ordinary line revenue and FIFO COGS after all bundle sets are returned. Keep standalone `sale_item_lots` and cash receipt untouched.
6. All existing Phase7E2, Phase7E3A, Phase7E3B1 and reporting tests must continue to pass. Prove RED with new authenticated business test, then minimal GREEN; complete GitHub Actions backend, React, Playwright and isolated Worker/D1. Do not merge without independent accounting/migration review.

## Out of scope
- Returning standalone items independently, multi-bundle cart partial refunds, full cancellation/void invoice status changes, credit/due/bank/discount, mixed unit and tracked stock. These remain gated for **Phase 7E3B2B**.
- Any redesign, new npm dependency, or production database change.

Expected FIFO example: initial W1 five units @৳20, W2 four @৳30; three kits use 6 wires, one standalone wire uses 1 (bundle draws W1×5 + W2×1; standalone draws W2×1). Two cash refunds return 1 kit then 2 kits, leaving only the standalone W2×1 consumed. Three original switches @৳5 are restored for kit sets. Net revenue ends at the standalone ৳10 and COGS at ৳30.
