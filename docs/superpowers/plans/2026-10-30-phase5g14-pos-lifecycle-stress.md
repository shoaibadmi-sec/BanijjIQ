# Phase 5G14 — Real-browser POS second-sale stress and invoice preservation

> Superpowers implementation plan (TDD + Ponytail), following merged Phase 5G13 / PR #52 and project-wide policy / PR #57.

## Context and decisions

- **Why:** Issue #35 remains open; a real Worker/D1 browser sometimes erased the second sale's customer name without resetting the form. Phase 5G13 added a deterministic stale-input guard, but naturally occurring rapid focus/dialog transitions are not yet stress-tested.
- **Scope:** Expand the existing isolated `d1-checks/browser.mjs` real Chromium → React → Hono Worker → D1 acceptance; preserve the existing receipt, invoice count and SQL stock checks. No UI redesign and no unrelated accounting code.
- **Ruling:** This slice is **regression/characterization tests only** unless a new RED failure demonstrates a real product defect. Don't invent a failing test, make speculative production code changes, or close Issue #35 based on green runs. Avoid modifying extra fixtures or D1 data.
- **Isolation:** Full existing browser fixture runs at 390px and 1440px. Only 1440px posts actual sales; use unchanged Worker/D1 customer fixture, no additional database mutations.
- **Ponytail:** Reuse the current browser test and native Playwright fields, no new packages or helper abstractions.

## Tasks

1. **Read:** Check `AGENTS.md`, Issue #35/PR #52 and the actual second-sale browser flow. Record existing test/source behavior.
2. **Tests first:** Extend the second-sale browser scenario with repeated, ordinary user interactions (`name.fill` → `phone.fill` → payment focus and keyboard shortcuts), alternating values and verifying after React frames that only the intended current customer data remains; after the loops, restore final same source customer details. Assert reset version unchanged, no extra `/api/pos/sales` POST before confirmation, exactly one POST after confirmation, existing persisted D1 invoice and final SQL stock invariants intact.
3. **Verify:** Run `HisabIQ React / BanijjIQ API integration` on the test-only PR. If the test fails with an **actual behavioral mismatch**, keep the RED log, identify the root cause and apply the smallest tested fix. If the test passes from first run, keep the test-only scope—no fabricated RED or production code.
4. **Complete:** Require exact-head backend build, financial and Phase3/4/5 suites, React source parity, responsive Playwright/axe, isolated Worker/D1. Review patch and squash merge **only** on complete GREEN.
5. **Do not infer:** No remote hosted deployment, production migrations, automatic issue closure, or certification of unmerged Phase3 split tender and Phase6 finance.

## Definition of done

A correctly posted second sale after repeated input/focus/blur churn retains its customer, phone, payment, single POST and original accounting reconciliation; the new test permanently runs under the required CI check, while Issue #35 stays open until independent naturally timed repeated reproductions justify closure.
