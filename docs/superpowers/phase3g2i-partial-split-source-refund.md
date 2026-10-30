# Phase 3G2-I — Partial Split-Tender Sales Returns (TDD + Ponytail)

**Repository:** `shoaibadmi-sec/BanijjIQ` React + Hono/Cloudflare D1.
**Dependencies:** Draft #20 → #26 → #31 → #33 → #42 → #45 → this slice (#47). Phase 3F #18 and Phase 3G1 #19 already merged.
**Status:** Source allocation + full-refund request hardening only. **Partial refund posting NOT enabled.**

## Accepted financial contract

- Work against a fully paid split sale, with independently proved original Cash/Bank/Mobile/Store Credit journals, active linked credit customer and original FIFO lots.
- A partial return posts only explicitly selected, originally sold and still-returnable units. Refund is based on the original saved net unit price; never exceed the original refundable funds or already-restored original FIFO quantity.
- Every original source is tracked by immutable `source_key` (e.g. `Bank:B-1`, `Mobile Banking:M-1`, `Store Credit`). Do not redirect bank payments to another account or convert Store Credit into Cash/A/R.
- Integer-poisha partial allocations use the remaining original source amounts, not floating-point percentages. Compute floor(weighted share), then assign leftover individual poisha by greatest remainder with original source order tie-break. Never exceed each source's remaining cap or emit zero-amount refund journal rows.
- Every partial return consumes those source caps **once**. Multiple returns may use one invoice, but sum of each source's allocated returns must never exceed the matching original tender allocation. A final return must exhaust every source exactly and reconcile to the original invoice amount.
- Cash/Bank refund debits, Store Credit ISSUE entries, stock lots, products, return items, immutable per-source allocation, cash session, D1 audit and idempotency all commit atomically. Any trigger failure or stale source state rolls back **everything**.
- Every read and write checks tenant/database boundary and `returns.view` / `returns.add`. The invoice stays visible for audit. Unknown network results force ledger/history inspection before retry.

## Implemented in first safety slice

- `tests/split-sale-tenders.integration.test.ts` now rejects `items`, `requestedRefundCents` and `allocations` on the **whole-invoice** POST. Previous service ignored them and could post an unintended FULL refund (proved RED in CI #594).
- `server/modules/sales/split-reversal.ts` allows only the existing `reason` field for the full-refund POST, preserving original transaction/migration behavior.
- `server/modules/sales/partial-split-refunds.ts` pure, no-I/O integer-poisha allocator; tested in `tests/partial-split-refund-allocation.integration.test.ts` for repeating returns, source caps, different accounts, one-poisha remainder, unchanged originals, and invalid/overdrawn history.
- Existing GitHub `npm run test:phase3` invokes both regression suites. Green still means **engineering validation only**, not approval of partial posting.
- `GET /api/sales-management/:id/split-partial-preview?productId=<ID>&quantity=<WHOLE_NUMBER>` is a **read-only first-return quote**: reuses the full original-source ledger/FIFO preflight, calculates integer-poisha source amounts from the saved invoice item, and returns `postingEnabled:false`; there is intentionally **no** partial POST route. Existing Returns permissions (`returns.view`) gate access. Repeated partial returns cannot yet be quoted because the audited historical-source journal is not in place.

## Remaining vertical implementation before enablement

1. **RED:** Create full-migration SQLite/real D1 fixtures for partial quantities and historical returns, with Cash + Credit and Bank + Mobile + Credit, idempotency and concurrency. Include prior-return journal drift, credit ownership, duplicate original source keys, and unsupported tracked/vendor/negative/mixed-unit/discount cases.
2. **PARTIALLY DELIVERED:** Read-only quote for one original item and zero prior partial returns is implemented and guarded. Extend it to reconcile **prior per-source refund journals**, quantity-return history and stale source balances before allowing a follow-on partial quote; still no posting.
3. **RED:** Specify additive D1 migration for append-only partial source allocations and per-return FIFO proof. Existing migration 0047, its full-reversal audit and Store Credit ISSUE guards enforce `return total == invoice total` and cannot be reused unmodified for partial returns. Keep legacy/full triggers unchanged; add separate narrow partial triggers to avoid Cloudflare D1 expression-depth errors.
4. **GREEN:** Write one minimal atomic service using the original stock, Cash/Bank and Store Credit journals; verify each source's `original = already refunded + remaining` in the transaction, including last return; reject lost-update/stale data and two requests using the same invoice concurrently.
5. **RED→GREEN:** Only after isolated D1 finance checks pass, add the partial-return selection/review to the **existing** compact HisabIQ Sales Returns UI. Include original-source allocations and Store Credit ≠ Cash in Bangla helper; confirm/POST once, error recheck and 390/768/1440 screenshot + axe tests.
6. **Acceptance:** exact-head complete CI, hosted preview review and independent accounting/security approval. Merge stacked dependencies in their real merge order; no remote/production migrations or deployment until separately authorized.

## Required release-blocking negative cases

Partial requested against FULL route; return more than sold; duplicate quantity; previous return already consumed a source; unbalanced source allocation; inactive changed bank; credit legacy mismatch; wrong customer; bank/current ledger drift; wrong source key; fake cash for Store Credit; duplicate request/retry; two simultaneous partial returns; FIFO update ignored; final audit insert rejected; cash/bank failure after stock restored; credit ISSUE failure after bank debit. **All must leave unchanged returns, stock lots, bank/cash books, credit liability, journal allocations and original invoice.**
