# Mohim → BanijjIQ: virtual bundle checkout, FIFO, returns and reversal (phase 2)

**Branch:** `feat/mohim-bundles-sale-fifo` (stacked on draft PR #5 `feat/mohim-bundles-phase1`, which is stacked on draft PR #4).
**Primary Mohim reference:** `shuvodelux-commits/Mohim_ERP` `Bundles.gs`, approved 2026-10-13 virtual bundle design. **Status:** development draft; no production D1/Worker changes.

## Delivered on this branch

### Sale posting

- Bundle appears as **one sellable POS product / invoice line** with its own selling price and `unit=Set`.
- A single checkout can include independent Standard products and virtual bundles, including shared physical components.
- Before any DB write, expand all submitted kits into their **historical revision's** component demands, then allocate all physical Standard demand from a **shared FIFO lot-state map**. This prevents the same lot being consumed twice by two cart lines.
- Stock movements, `sale_item_lots` source lineage and immutable `sale_bundle_components` snapshots record component quantities, FIFO unit costs, parent bundle, and lot IDs. Bundle `products.current_stock` stays **zero**.
- Component shortage is permitted (negative sale) using a source-invoice `OVERSOLD` lot; standalone Standard shortage in a mixed checkout remains guarded.
- One atomic D1 batch writes invoice, visible items, physical lots, canonical stock, cash/bank/customer ledger and audit entries.
- Optimistic stock and lot version checks reject stale checkout plans in the same atomic batch. A competing update produces a failure instead of silently overwriting stock.

### Returns and reversals

- Full-set-only bundle returns: return **whole bundle quantities**, never individual kit components. One invoice may have multiple returns until its quantity is exhausted.
- Uses the **sold recipe snapshot**, not the newest recipe after later bundle edits. Preserves prior-return lot ledger in new migration `0031_bundle_return_provenance.sql` through `sale_return_bundle_lots`.
- Restores exactly the recorded consumed FIFO lots, including oversold negatives, in one D1 transaction.
- Cash refunds are limited by the cash actually collected on that **source invoice** after prior cash refunds. Store Credit updates the customer ledger; walk-in customers are created/linked in the same batch only as needed.
- Eligible invoice deletion restores its physical lots, canonical component balances and paid/due bookkeeping once; repeating the deletion is rejected. Deletion is blocked after any return or after the cash session is closed.
- Existing ordinary Standard returns can operate on an invoice containing a bundle without accidentally restoring the bundle's attributed lot rows.
- **Mixed bundle+ordinary-product lines in a single return request are deliberately rejected**; return them in separate requests until combined return posting is reconciled.

### Reports

- Profit and Dashboard reports now group physical FIFO cost by `source_sale_product_id`, so one visible bundle has one revenue and COGS/profit bucket.
- Bundle returns reverse the **actual original FIFO unit cost** of returned component lots, not a proportional estimate.
- Standard items without explicit parent source retain the existing legacy fallback. Historical reports do not manufacture extra visible component-sale lines.
- Returned amounts are subtracted at the recorded **net refund amount** (not discounted twice).

## Verification

- `npm run test:mohim-parity`: **18 integration tests pass** (original multi-unit + atomic batch returns + bundle master + bundle posting, two-cashier FIFO race, full-set return, profit and invoice reversal).
- `tsc -p tsconfig.server.json --noEmit`: passed.
- `npm run build`: passed.
- `npx wrangler d1 migrations apply DB --local`: passed including `0031`.
- `npx wrangler versions upload --dry-run`: passed; D1 binding remains `DB (shererp-new-db)`; no upload or activation occurred.
- Production SQL backup restored **in-memory** and only there migrations 0028–0031 applied: row counts unchanged for users (2), products (9), sales (6), purchases (3), returns (2), sale items (13), lots (16), stock movements (36), customer ledger (12), vendor ledger (1), cash book (19), bank book (4). SQLite integrity and foreign-key checks passed.

## Deliberate release blockers

1. Bundle invoices are **not editable** yet; edit requires full atomic reversal and repost of all physical components, payment methods and profit audit. It is explicitly denied at the API rather than silently misposting.
2. Bundle products are blocked from **customer-first multi-invoice batch returns**. That path needs component-based lot attribution and source-specific settlement accounting added together.
3. Bundle checkout presently rejects serial/expiry/warranty-tracked components (even if Standard), vendor-sourced Standard lines, and mixed tracked-product carts. Those require a dedicated tracking/consignment allocation adapter.
4. Refunds **above** historical net unit price (with required reason and separate expense) are not yet implemented; bundle refund price is capped at net original price.
5. Need synthetic staging D1 end-to-end browser checks: keyboard POS, searching/returning bundle invoices, phone/tablet overflow, invoice printing, reconciliation after concurrent cash sessions and cross-date sales/returns.
6. Existing global report period semantics attribute returns to the source sale's report period; finance/accounting date-period policy should be verified before production.
7. Complete unit-price conversion and bundles sharing multi-unit components still use canonical base quantities for each recipe; transaction-local price-in units, split-payment, template/draft and fully mixed return cart remain pending.
8. Review role-based sales/return/delete permissions and auth for this new path, plus concurrent refunds of the same source invoice, and hardened idempotency keys.
9. Take a **fresh** encrypted production D1 backup and verify a restored **staging** database. Apply migrations only to staging first and rerun full UI/accounting suite. Promote live migrations/Worker only by explicit approval and after prerequisites are complete.

**Do not merge into `main`, auto-promote `shererp-new`, or execute remote D1 migrations from this PR.** This is a tested development slice and is not claimed production-ready.
