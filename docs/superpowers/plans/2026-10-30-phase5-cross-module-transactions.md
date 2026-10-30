# Phase 5 Cross-Module Transaction Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development. Watch regressions fail before changing production code.

**Goal:** Prove real purchase → FIFO POS sale → return → supplier settlement accounting reconciles directly against D1-compatible SQLite sources and Phase 5 read-only reports, including retries, concurrency and forced rollback.

**Architecture:** Call the existing authenticated `handleApiRequest` with the complete migrated disposable SQLite database. Assert SQL stock lots/ledger/money-book journals and independently expected report metrics; do not create fake postings or mock services. Existing module-level tests continue covering independent invalid inputs and edge cases.

**Tech Stack:** TypeScript, Node test/assert, SQLite, Hono/Cloudflare D1, existing React/Worker CI.

**Spec:** `docs/superpowers/phase5-reports-release-acceptance.md` and user-approved cross-module transaction test coverage.

## Global Constraints
- Branch is GitHub-only and Phase-5-specific. Never cherry-pick draft Phase 3, Phase 4, or Phase 6 PRs.
- No invented Store Credit/split tender liability, general-ledger P&L, or Phase 6 finance posting certification.
- Preserve existing UI, only two Reports tabs, read-only reporting, and no production deployment.
- Reuse existing test libraries and fixtures, no dependencies or migrations.

## Review Focus
1. Purchase 10 @20 → cash sale 4 @35 → return 1 @35: stock/lot 7, inventory value 140, original FIFO COGS 60, net sale 105, gross/net cohort profit 45.
2. Supplier settlement 50 updates due 200→150, money book, and payables, **not** profit.
3. Identical POS sale and supplier settlement retries must not double post journal or stock; conflicting reused keys fail.
4. Forced SQL abort must roll back invoice/lot/ledger/cash and idempotency.
5. Two simultaneous sales cannot consume the same last FIFO quantity; trace all reports after winner.

## Task 1 — Real cross-module purchase/sale/return/report
- [ ] Add `tests/reports-transaction-lifecycle.integration.test.ts` with single authenticated full-migration fixture and hand-calculated monetary assertions.
- [ ] Trigger GitHub CI via isolated test branch, fix only verified integration problems.

## Task 2 — Money, failure, and concurrency acceptance
- [ ] Test supplier settlement cash posting and non-profit categorization.
- [ ] Test POS idempotency and rollback with a synthetic SQLite trigger.
- [ ] Test concurrent independent POS writes against a single available lot and read report snapshots.
- [ ] Keep tests deterministic and independent across fixtures.

## Task 3 — Required CI
- [ ] Modify only `.github/workflows/hisabiq-react-build.yml` to run the new test alongside existing Phase 3/4/5 tests.
- [ ] Verify exact-head all required GitHub jobs: TS build, transaction tests, current reporting suite, React, Playwright/axe, and isolated Worker/D1.
- [ ] Review diff; merge only if green. Hosted production release remains HOLD.

## Excluded Until Merged
- Unmerged Phase 3 split tender / Store Credit, Phase 6 Daybook and full finance, and unsupported full P&L are marked unverified, not silently passed.
