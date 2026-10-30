# Phase 7B FIFO Valuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans with superpowers:test-driven-development. Every product change must follow a test that failed first.

**Goal:** Prevent unsafe stock asset valuation from malformed FIFO sources and numeric overflow.

**Architecture:** Minimal guards within existing source-backed stock report; no new valuation service, table or UI.

**Tech Stack:** TypeScript, Hono, Cloudflare D1-compatible SQLite, Node test runner and tsx.

**Spec:** `docs/superpowers/specs/2026-10-30-phase7b-fifo-valuation-design.md`

## Constraints and review focus
No production or hosted DB operations, merge, source mutations, dependencies or UI changes. Test for over-precision, impossible lot balances, unbounded totals, query sorting/pagination, and valid two-lot behavior. Preserve pre-existing reporting contracts.

### Task 1 — Business rules (RED)
**Files:** Create `tests/phase7b-fifo-valuation.business.test.ts`.
**Interfaces:** Consume `readStockDues(db,q)` and `parseLiveReportQuery(url)` from existing modules.
- [ ] Add real full-migration D1-compatible SQLite tests, with literal expected amounts and statuses.
- [ ] Commit tests before changing source code.
- [ ] Trigger CI, inspect failure of assertions within the actual report (not missing imports or fixture errors).

### Task 2 — Minimal report guards (GREEN)
**Files:** Modify `server/modules/reporting/live/stock-dues.ts`.
**Interfaces:** Keep exported `readStockDues` and `LiveReportPage` unchanged.
- [ ] Reject 5dp quantity and cost.
- [ ] Compare exact 4dp master and lot totals.
- [ ] Reject impossible remaining quantity exceeding original source quantity.
- [ ] Reject unsafe whole-store integer-poisha accumulation.
- [ ] Run Phase 7B tests and full existing reports business tests, verify zero regression.
- [ ] Commit smallest change.

### Task 3 — Acceptance and review
**Files:** Modify `package.json`, `.github/workflows/hisabiq-react-build.yml`; commit as part of tests-only change so CI RED is visible.
- [ ] npm run test:phase7b
- [ ] npm run backend:build
- [ ] Existing reporting + Phase 3/4/5 test gates
- [ ] GitHub exact-head React build, browser Playwright/axe and isolated Worker/D1 CI
- [ ] Record verified CI results and accounting limitations in draft PR.
- [ ] Independent accounting review before merge; no release on CI alone.
