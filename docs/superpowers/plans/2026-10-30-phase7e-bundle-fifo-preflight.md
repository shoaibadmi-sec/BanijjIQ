# Phase 7E1 — Bundle Component FIFO Preflight (Superpowers/Ponytail)

> **Approved roadmap continuation:** Phase 7E inventory and bundle integration. Release *preflight only*; bundle POS posting is NOT enabled.

**Objective:** Safely evaluate a proposed virtual-bundle recipe + same-cart ordinary items against true physical component FIFO lots, exact original acquisition cost and current master stock, without writing inventory or accounting data.

**Context:** Older draft PR #5/#6 already contains a complete virtual-bundle/Mohim implementation, but is stacked on draft PR #4 and diverged from current HisabIQ React main. Do not merge its Vue UI or blindly port its posting/return pipeline.

**Endpoint:** `POST /api/products/bundle-fifo-preview`, read-only under Products.view. Body: `{sets: positive integer, components:[{productId,quantityPerSet}], standalone?:[{productId,quantity}]}`. No new migrations, dependencies, UI, or remote database use. This accepts a *proposed recipe*, not proof of a saved revision. Callers must still snapshot authoritative versioned recipes when full bundle posting is implemented.

**Business contract:**
- 1–30 distinct physical components; positive integer quantities; no duplicate component ID; separate standalone demands are aggregated into the same physical product demand, preventing double-booking one FIFO lot.
- Use base units, no mix-unit conversion assumption. Require finite positive whole sets and unit quantities, products active/not deleted, no serial/expiry tracking (which needs dedicated allocation), no mismatched source lots, no OVERSOLD or uncategorized negative lot, no source cost <=0.
- Lot draw order `created_at ASC,id ASC` with deterministic ties. Each product's gross demand is allocated once. Each draw returns `lotId, quantity, unitCost, costMinor`; total poisha is integer sum of individually rounded lot costs at acquisition cost. Retail selling price and product default price are never valuation inputs.
- Fail closed 400 for invalid body, 404 for nonexistent products, 409 for shortage/inconsistent/corrupt/tracked sources. Return no partial readiness on refusal.
- No D1 INSERT/UPDATE/DELETE at all. Preview is advisory, cannot reserve stock or authorize checkout. Future sale posting must redo calculations in an atomic D1 batch.
- POST is an idempotent read-only query. Exact read-only Product role can preview; users without Product.view cannot.
- Existing POS, physical stock adjustment, and Phase 7D drafts unchanged.

**Plan**
1. RED — tests/phase7e-bundle-fifo.business.test.ts and tests/phase7e-bundle-fifo.route.test.ts on migrated in-memory SQLite with authenticated Hono, add CI `test:phase7e`; commit then run, confirm missing endpoint 404 assertion.
2. GREEN — smallest service `server/modules/products/bundleFifoPreview.service.ts`; register route; precise permissions mapping to view; no migration.
3. Verify focused tests, previous accounting suites, original React build, Playwright, Worker/D1. CI on exact PR HEAD. Keep DRAFT pending independent account/integration review; next Phase 7E2 port/validate complete atomic bundle posting and reversals from PR #6 into React main.
