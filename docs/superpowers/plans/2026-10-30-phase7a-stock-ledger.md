# Phase 7A TDD Implementation Plan — 2026-10-30

Source: docs/superpowers/specs/2026-10-30-phase7a-stock-ledger-design.md
Branch: feat/hisabiq-phase7a-stock-ledger-tdd (draft PR; GitHub-only).

## Task 1 — RED business and API contracts
- Add tests/phase7-stock-ledger.business.test.ts on fully migrated disposable SQLite.
- Add tests/phase7-stock-ledger.route.test.ts on real authenticated Hono handler.
- Add separate npm scripts and CI gate.
- Observe expected RED on the exact test-only branch head before any production code.

## Task 2 — GREEN with the smallest existing-schema change
- Add server/modules/products/stockLedger.service.ts using SherDatabase and existing product/lot/movement tables; never add a second ledger.
- Add exactly one GET route /api/products/:id/stock-ledger to existing products router.
- Validate 50/100 page sizes, typed 4-decimal stock quantities, record limits, and no source writes.
- Return status needing review for missing/corrupt/contradictory source evidence. Preserve invoice-per-lot final balances and exact source movement IDs.

## Task 3 — VERIFY
- npm run test:phase7:business
- npm run test:phase7:route
- npm run test:phase7
- npm run backend:build
- Full GitHub PR pipeline: current Phase 3/4/5 regression gates, React compilation, Playwright/axe, isolated Worker/D1.
- Review exact PR-head SHA and SQL accounting output; if not verified GREEN, leave draft.

## Boundaries
No production Cloudflare migrations/deploy, no merging unfinished Phase 3–6 drafts, no new dependency, no restyling the approved UI, and no stock mutation in this slice.

## Review focus
Existing source writers may emit multiple movement rows with the same final balance, and old imported products may have missing history. A passed stock-quantity reconciliation is not an external stock count or FIFO cost report.
