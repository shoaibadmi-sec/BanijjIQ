# Phase 7C stock-loss posting — Superpowers TDD / Ponytail plan

> **For agentic workers:** Use Superpowers RED → GREEN → verify with separate business and transaction tests.

**Goal:** Record damaged and wasted physical stock at original FIFO acquisition cost, without creating cash expense or an invented P&L journal.

**Architecture:** Existing /adjust-stock remains for regular corrections. Add one authenticated Products.edit endpoint POST /api/products/:id/stock-loss and a compact D1 source ledger for request idempotency + loss-lot source allocations. Source product master, FIFO lots, stock_movements, event, and allocations must post in ONE D1 batch. Production database and UI unchanged.

**Tech Stack:** Cloudflare Workers/Hono, D1-compatible SQLite, TypeScript, Node built-in test runner, tsx.

**Spec / business decisions:**
- Reasons only DAMAGE and WASTAGE. Must provide a unique clientRequestId (12–100 safe ASCII characters), a positive four-decimal base-unit quantity and optional note (≤ 200 chars).
- Record FIFO lot draws with original unit_cost and per-draw loss cost in integer poisha, using rounding to nearest poisha per lot, with total cost the sum. There is no retail amount, cash-book entry or P&L expense posting.
- Reject missing/deleted products, tracked stock, negative or insufficient stock, malformed/overflowing amounts, mismatched master and lot sum, remaining greater than original, and OVERSOLD sources.
- An identical clientRequestId + identical immutable payload must replay with no writes. Changed payload or changed product using same ID returns HTTP 409.
- Optimistic product master and lot CAS in a single batch. Inject an SQL failure on a stock movement and prove rollback of the product, lots, allocations and loss header. Idempotency and isolation must be durable in D1.
- Existing product history shows one loss movement per consumed original lot with source lot ID and invoice-independent movement IDs. No mutation of original cost or sale provenance.
- Keep users with Products.view but no Products.edit from posting. No tenant-specific cross-DB access; tenant isolation is defined by the existing per-tenant D1 binding.
- Use existing product-adjustment flow for correction counts, rather than duplicate it; this slice implements damages and wastage only.

## Task 1 — RED
- Create tests/phase7c-stock-loss.business.test.ts and tests/phase7c-stock-loss.transaction.test.ts, with fully migrated isolated SQLite and real authenticated API.
- Add npm scripts and CI gate. Commit test-only source changes; run GitHub Actions and inspect failed behavior assertions before implementation.

## Task 2 — GREEN
- Create migrations/0060_inventory_loss_journal.sql, server/modules/products/stockLoss.service.ts. Add route and Products.edit permission.
- Implement only minimal validation, FIFO draw and atomic D1 batch with immutable audit event. No frontend and no cash/expense writes.

## Task 3 — Verify
- New business and transaction suites, existing products and Phase 3–5 accounting tests, backend typecheck, React build, Playwright, isolated local Worker/D1.
- Exact-head full GitHub CI success required. Independent accounting review and migration rehearsal before merge; keep draft.
