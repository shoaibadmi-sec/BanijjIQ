# Mohim virtual product bundles — guarded master/recipe implementation

**Status:** bundle definition and UI slice only; bundle SALE POSTING IS NOT ENABLED. This is a stacked draft pull request based on PR #4, not a release.

**Canonical source:** `shuvodelux-commits/Mohim_ERP@f95be8d`, `Bundles.gs`, `docs/superpowers/specs/2026-10-13-virtual-product-bundles-design.md`, and `tests/bundle_*.test.js`.

## Implemented in this PR

- Additive `0030_virtual_bundle_master.sql` with product type `Standard|Bundle` (historical products default to Standard), bundle revision, `bundle_components` versioned physical recipes and future invoice/provenance schema placeholders.
- `POST /api/bundles`, `GET /api/bundles`, `GET /api/bundles/:id`, `PUT /api/bundles/:id`, `DELETE /api/bundles/:id` (deactivation, never physical deletion). Routed through existing Products permissions and audit logs.
- Product table **Add Bundle** and action **Edit Bundle**, independent bundle selling price, searchable active Standard component selector, quantity-per-set, informative available-sets calculation.
- Standard components never become independent bundle stock. Calculation: min floor(max(0, physical stock)/qty per set). Bundle stored stock is **zero**.
- Reject repeated, inactive, nonexistent, serial/expiry tracked, virtual and nested components; reject quantities <=0, fractional or excessive; reject conflicting product names/barcodes.
- Edits after a prior sale create a new bundle revision and preserve the earlier recipe. Edits before any sale replace the draft revision. Stale expected revisions rejected.
- Block ordinary product-edit, stock-adjust, stock-lot, unit-conversion and deletion endpoints on bundles. Block deleting a product required by an active bundle.
- Exclude bundles from POS bootstrap, reject direct unauthorized bundle sale attempts in the existing sale posting route, and reject bundle as a purchase item through existing purchase APIs. **Bundle creation is a setup operation only** until the bundle sale/reversal/return engine is complete.
- Product Bootstrap exposes `productType`, `bundleRevision`, `availableSets` and `sellableStock`; product table displays **Bundle · Setup** and available sets, not fake physical stock.

## Tests and migration verification

- New `tests/mohim-bundles.test.ts`: virtual stock unchanged, available-sets calculation, no POS leakage, direct sale rejection, invalid/missing/duplicate components, nested-bundle protection, deletion protection, version preservation, stale update rejection and deactivation.
- Entire stacked parity suite (multi-unit and batch returns included): **7 tests passed**.
- `npm run build`, Hono TypeScript typecheck and `wrangler d1 migrations apply DB --local`: passed (29 migrations).
- Migrations 0028–0030 additionally applied only to an **in-memory restore of the genuine production SQL backup**, with 2 users, 9 products, 6 sales, 3 purchases, 2 returns, 13 sale lines, 16 stock lots and 36 stock movements unchanged. SQLite integrity and foreign key checks passed.
- Production `shererp-new` Worker and `shererp-new-db` D1 remain unchanged.

## Still required before bundles can be sold or this stack merged

1. Server-side physical demand expansion for mixed Standard+Bundle checkout, allocate FIFO lots once per physical component even when multiple lines share the same product. Cover negative/oversold fallback, source-owner attribution and independent bundle selling price.
2. Atomic `sale_bundle_components` revision snapshot and `sale_item_lots.source_sale_product_id`; visible `sale_items` keeps one bundle line. Never expose component revenue on the customer invoice.
3. Full-set-only sales returns with correct component lot restoration, vendor/oversold handling and financial refund checks. Batch returns must preserve parent bundle provenance and independent child return IDs.
4. Invoice update, duplication, delete reversal and durable draft handling; reject unsafe edits until complete. No partial component refund.
5. Exact profit/COGS and report logic, permissions, fresh-read conflict checks and user-facing mobile/keyboard accessibility review.
6. Preview with an **isolated test D1** and a separate production migration approval. Do not merge/promo/enable existing bundle definitions before the entire sale-to-return lifecycle is implemented.

## Branch sequencing

- PR #3 is merged; PR #4 is a separate DRAFT covering mixed-unit POS + first batch return slice.
- This PR is **stacked onto PR #4**, with migration `0030`. It must **not** merge directly to `main` before PR #4 is ready.
- GitHub CI will validate Vue/Hono/parity tests and D1 `--local` migrations, never production D1.
