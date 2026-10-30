# Phase 5G12 — Customer Receipt / Due / Bank Accounting TDD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or test-driven-development; record RED then minimal GREEN.

**Goal:** Prove customer settlement transactions never create negative receivables, lost payments, or bank balances inconsistent with their money-book entries.

**Architecture:** Real full-migration SQLite plus authenticated Hono API; one end-to-end test owns the invoice, customer, cash session, bank ledger and Phase 5 reports. First commit only the regression and CI hook, watch it fail, then fix at the existing shared receipt service. No new UI, dependencies, or migrations unless a test proves a database-level constraint necessary.

**Tech Stack:** TypeScript, node:test, sqlite/D1, Hono, Cloudflare Worker CI.

**Spec:** User-approved Phase 5G12 cross-module accounting hardening following merged Phase 5G11 PR #49; Reports must fail closed on corrupt sources.

## Tasks
- [ ] Establish that main merge #49 is baseline; project workflow only runs on PR or manual dispatch, so a new isolated PR verifies current main plus tests.
- [ ] RED: post a due invoice and cash payment; refuse overpayment with zero ledger/money-book changes.
- [ ] RED: post bank receipt and demand exact posted bank balance, bank-book and report parity.
- [ ] RED: after settling remaining due, concurrent independent requests cannot both credit the same receivable.
- [ ] GREEN: use minimal modifications in shared customer-payment handler; atomic database updates and source-validated money posting.
- [ ] Verify existing Phase 3, 4 and 5 suites, React Playwright/axe, isolated D1, exact commit; merge only on full green.
- [ ] Keep Issue #35 open for separate UI race investigation unless reproducible and fixed. No hosted/prod deploy or unmerged Phase 3/4/6 branch adoption.

**Ruling:** Scope one transaction type rather than all Phase 3–6 changes; another module owns split tenders and paid purchase branches. No source-certified all-ledger P&L claim.
