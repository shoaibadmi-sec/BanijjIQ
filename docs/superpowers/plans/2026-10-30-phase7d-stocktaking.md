# Phase 7D Physical Stocktaking — Superpowers TDD Plan

> **For agentic workers:** Use superpowers:executing-plans, test-driven-development and Ponytail.

**Goal:** Capture a physical count per product, approve only after stock source reconciliation, and atomically reconcile FIFO inventory with immutable audit history.

**Architecture:** Existing products/stock_lots/stock_movements are authoritative. A new count header retains capture/approval identity and snapshot, and source-lot allocations retain the original cost. Capture POST only creates PENDING count; approval POST uses one D1 batch for header status, product/lot updates, movements, and allocations. GET reads saved count. No frontend redesign.

**Tech Stack:** TypeScript Hono, SQLite/D1, node:test, tsx.

**Spec:** Phase 7D stocktaking roadmap. A count is one product. No hosted D1 deployment.

## Invariants
- Valid unique countId, nonnegative four-decimal base-unit quantity, bounded note; snapshot of expected stock, user, timestamp. Duplicate IDs conflict.
- Count capture changes NO stock. Approval requires Products.edit; capture Products.add; GET Products.view.
- Shortfall consumes FIFO surviving lots at original source unit cost, records source cost in integer poisha. Positive surplus requires explicitly verified nonzero four-decimal original acquisition unitCost, NEVER an inferred catalog retail or purchase price. Exact count needs no movement.
- Approval only while original master stock matches captured snapshot and all FIFO source lots reconcile; no tracked serial/expiry or OVERSOLD product approval. CAS prevents concurrent double-post.
- All stock, status, allocation and movement entries roll back on injected journal failure. Repeat approved count is read-only and returns replay. Stale count returns 409, not silent rebase.
- Never post cash, bank, expense or profit journals from this workflow; loss value is audit evidence, not recognized write-off.
- Existing manual adjust-stock unchanged. No remote migration, deploy or merge pending independent accounting review.

## Tasks
1. [ ] Add separate real-Hono/full-migration business and transaction tests, package and CI scripts. Commit before production changes. Verify RED on GitHub.
2. [ ] Add migration `0061_physical_stocktaking.sql`, compact stocktake service, routes and Products.edit approval permission. Run tests; minimal GREEN.
3. [ ] Verify exact-head full workflow: backend build, accounting suites, React build, Playwright/axe and isolated Worker/D1. Review SQL migration and inventory accounting. Leave draft/unmerged until review.
