# HisabIQ Store Credit Full Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a financially correct full Store Credit module, from legacy reconciliation through split tender and returns to audited release, without changing the established HisabIQ React design.

**Architecture:** Extend the existing integer-poisha liability journal with explicitly sourced compensating events and a separate per-sale tender allocation journal. Preserve current invoice columns and single-tender clients as compatibility interfaces; post stock, tender, bank/cash, due, liability and audit atomically in one Cloudflare D1 batch.

**Tech Stack:** React + TypeScript + shadcn/Tailwind, Hono Worker API, Cloudflare D1/SQLite migrations, GitHub Actions, Node/tsx integration tests, Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-10-30-store-credit-full-completion-design.md` (PROPOSED — scope approval required for G2-F/G/H/I).

**Current snapshot:** 2026-10-30: original G2-A/B/C/D implemented in draft PR #20, local CI green at `08be44568c12e12dce125861747453cd1f7baa2f` (run #241); hosted-preview and independent financial acceptance are pending. PR stack: #18 → #19 → #20, all draft/unmerged when checked.

## Global Constraints

- GitHub-only: separate draft feature branches/PRs with reviewable commits; Phase 4 Purchase and Phase 5 workflows must not share or overwrite Phase 3 feature branches.
- Never change migration files already applied. Proposed new migration filenames are `0043_store_credit_cases.sql`, `0044_sale_tender_allocations.sql`, `0045_store_credit_reissue_guard.sql` (all absent on the reviewed phase branch); check the complete repo migration inventory at execution and allocate new numbers instead if any conflicting migration appears. Do not reuse the deleted experimental `0042` migration.
- No production Cloudflare Worker or remote D1 migration; use isolated test D1, explicit hosted-preview environment authorization and human release signoff.
- Store Credit liability is **not customer receivable**, cash, or bank deposits. Monetary accounting in integer poisha with no rounding drift.
- Preserve existing HisabIQ compact React POS, combined Party Ledger patterns, bilingual Bangla helper, responsive 390/768/1440 layout, keyboard navigation and a11y. No Vue conversion or wholesale redesign.
- Do not merge #20 before approved parent PRs #18 and #19; do not auto-merge any draft while hosted or accountant gates are skipped.
- Keep incompatible or unverified workflows fail-closed with 409 and no ledger/stock changes.
- Every production mutation has failing tests first, then minimum implementation, isolated D1/React CI, reviewer gate and a small commit.

## File Map (read the latest head before coding)

- `server/modules/sales/service.ts` — current POS, Sales Return, reversal, accounting batch integration. Avoid adding another large subsystem; delegate new tender/reversal logic to focused helpers.
- `server/modules/sales/types.ts` — existing `PosSaleInput`; additive typed `tenders` field for G2-G.
- `server/modules/sales/routes.ts` — Hono route wiring.
- `server/modules/sales/store-credit-reconciliation.ts` — existing read-only administrative anomaly detection; derive cases without auto-conversion.
- `server/modules/sales/store-credit-cases.ts` (new, G2-F) — preview, approval and sourced case resolution; distinct authorization.
- `server/modules/sales/sale-tenders.ts` (new, G2-G) — validation, amounts in minor units, account compatibility and allocation reconciliation.
- `server/modules/sales/store-credit-reversals.ts` (new, G2-H) — immutable compensating events and return eligibility.
- `migrations/0039_store_credit_liability.sql`, `0040_store_credit_issue_guard.sql`, `0041_store_credit_redemption.sql` — read only, never modify.
- `migrations/0043_store_credit_cases.sql`, `<next>_sale_tender_allocations.sql`, `<next>_credit_reissue_guard.sql` — create after verifying actual inventory.
- `react-integration/overlay/src/integration/banijjApi.ts` — typed API requests/responses.
- `react-integration/overlay/src/integration/LivePosPage.tsx` and `LiveCheckoutPanel.tsx` — add compact tender controls without restyling the existing cart/customer picker.
- `react-integration/overlay/src/integration/LiveSalesReturnsPage.tsx` — return/tender provenance and credit restoration.
- `react-integration/overlay/src/components/brand/ReceiptPreview.tsx` — show payment allocation and no fake cash.
- `tests/store-credit-reconciliation.integration.test.ts`, `store-credit-redemption.integration.test.ts`, `store-credit-issuance.integration.test.ts` — existing accounting baseline.
- `tests/store-credit-cases.integration.test.ts`, `tests/split-sale-tenders.integration.test.ts`, `tests/store-credit-reissue.integration.test.ts` (new) — isolated full-migration tests.
- `d1-checks/run.mjs`, `d1-checks/phase12.mjs`, `d1-checks/phase13-browser.mjs`, `ui-checks/run.mjs` — local Wrangler, concurrency, real-browser/D1, Playwright/axe gates.
- `.github/workflows/hisabiq-react-build.yml` — register new test files in existing CI. Hosted-preview jobs remain manual and isolated.

## Review Focus

These are the five most likely edge cases not sufficiently covered by the original single-tender contract; the owning tasks below each include the required test.
1. **Fractional-poisha prices and discounted mixed-unit quantities** — reject or reconcile exact allocations in G2-G Task 6, never round multiple rows independently to a different invoice total.
2. **Partial refund after prior Cash/Bank/Store Credit settlement** — G2-H Task 8 caps each refund method by the original verified tender and net unreturned quantity.
3. **Concurrent reconciliation approvals and credit redemptions** — G2-F Task 5 verifies a case can resolve once; G2-G Task 7 verifies no double spend.
4. **Stale or unauthorized cashier/customer credentials** — G2-F Task 5 checks admin authority and historical evidence; G2-G Task 7 checks inactive customer/bank account and mismatched phone.
5. **Credit issue/restoration audit write failure** — G2-H Task 9 injects a failure at the last audit operation and asserts every stock, tender, due, cash/bank and liability statement rolls back.

---

## Phase G2-E — Complete restricted-workflow release acceptance (partially complete)

### Task 1: Exact-head accounting and hosted release evidence

**Files:** Review `docs/superpowers/phase-3g2-release-acceptance.md`, `.github/workflows/hisabiq-react-build.yml`, `d1-checks/run.mjs`; record evidence in PR #20 description and `docs/superpowers/reviews/2026-10-30-store-credit-release-evidence.md`.

**Interfaces:** Consumes existing admin `GET /api/pos/store-credit/reconciliation` response (`readOnly`, `flagsCount`, `flagsTruncated`, `issuedCents`, `redeemedCents`, `outstandingCents`). Produces a signed evidence matrix; does not mutate balances.

- [ ] **Step 1 — Record the exact PR head**: read #18/#19/#20 current SHA, base ref, draft status, and latest per-commit Actions run. Only a success on the exact tested code SHA qualifies.
- [ ] **Step 2 — Verify accounting locally**: run `npm run backend:build` and `node --import tsx --test tests/store-credit-liability.integration.test.ts tests/store-credit-issuance.integration.test.ts tests/store-credit-redemption.integration.test.ts tests/store-credit-reconciliation.integration.test.ts`; expected all tests PASS.
- [ ] **Step 3 — Verify local real D1 and UI**: run `node d1-checks/run.mjs`, `node d1-checks/phase12.mjs`, `node d1-checks/phase13-browser.mjs`, `node ui-checks/run.mjs`; expected no failures, screenshots/axe artifacts attached.
- [ ] **Step 4 — Obtain authorized isolated hosted-preview run**: use the existing explicitly gated workflow and distinct preview-only Worker/D1; confirm it applies only intended migrations and tests the exact head. If authorization/secrets are absent, mark `PARKED — hosted preview`, not passed.
- [ ] **Step 5 — Record independent signoffs**: accountant reviews nonzero anomaly flags (no assumed conversion), security reviewer checks access and idempotency, UX reviewer checks 390/768/1440 and Bangla labels. Record reviewer, evidence links, SHA and date; commit evidence document without changing production code.
- [ ] **Step 6 — Gate**: allow merge #18 → #19 → #20 only after all required approved hosted and financial gates; never auto-merge or deploy to production as part of this task.

## Phase G2-F — Historical Store Credit reconciliation

### Task 2: Auditable case discovery and evidence preview

**Files:** Create `server/modules/sales/store-credit-cases.ts`, `tests/store-credit-cases.integration.test.ts`, next unapplied `migrations/0043_store_credit_cases.sql`; modify `server/modules/sales/routes.ts` and `.github/workflows/hisabiq-react-build.yml`.

**Interfaces:** `GET /api/pos/store-credit/reconciliation/cases` (admin only); `GET /api/pos/store-credit/reconciliation/cases/:caseId` returns immutable original source links, anomaly codes, proposed adjustment and `unverified` state. Case writes require a subsequent task.

- [ ] **Step 1 — Write failing tests**: fixture with unjournaled legacy return, negative due and prior payment; expect exact anomaly/case links, zero new spendable balance, authorized admin access only, stable pagination and no source edits.
- [ ] **Step 2 — Run tests**: `node --import tsx --test tests/store-credit-cases.integration.test.ts`; expected FAIL because case routes do not yet exist.
- [ ] **Step 3 — Implement minimal case schema and read API**: read-only projection plus immutable evidence attachment/reference IDs; use a new numbered migration after verifying the schema inventory. No auto-issue of credit.
- [ ] **Step 4 — Re-run tests and D1 migration test**; expected PASS under SQLite and local Wrangler D1, no `current_due`, cash-book, bank-book or journal changes.
- [ ] **Step 5 — Commit**: `feat(3g2-f): add reviewed legacy credit case discovery`, open separate draft PR stacked after accepted previous phase.

### Task 3: Approve/reject cases and post source-verified compensating entries

**Files:** Modify `server/modules/sales/store-credit-cases.ts`, `server/modules/sales/routes.ts`; add next unapplied migration (new case status and allowed journal source/event guard); extend `tests/store-credit-cases.integration.test.ts`.

**Interfaces:** `POST /api/pos/store-credit/reconciliation/cases/:caseId/resolve` with `{decision:'verified-outstanding'|'verified-settled'|'reject',reason:string,evidenceIds:string[],expectedVersion:number}`. Status transitions require role `admin`, explicit impact preview, one source-unique resolution and audit.

- [ ] **Step 1 — Write failing tests**: prove incomplete source evidence blocks approval; double-submit and concurrent approval resolve once; negative A/R does not automatically become credit; rejected/settled case cannot mint a liability; ledger adjustment only when independently justified and balanced.
- [ ] **Step 2 — Run test to confirm FAIL** on missing guarded resolution.
- [ ] **Step 3 — Implement guard, resolution and atomic journal/posting batch**: append compensating source-linked entries when verified; preserve historical originals, actor/time/reason/evidence and prevent silent legacy carryover. No direct mutation of old credit journal entries.
- [ ] **Step 4 — Run `node --import tsx --test tests/store-credit-cases.integration.test.ts tests/store-credit-redemption.integration.test.ts`; expect PASS, then isolated Worker/D1 and accountant case-by-case validation.
- [ ] **Step 5 — Commit** `feat(3g2-f): resolve verified historical liabilities once`; remain draft until an independent financial review.

## Phase G2-G — Multi-tender and optional partial due

### Task 4: Integer-poisha per-sale tender allocation contract

**Files:** Create `server/modules/sales/sale-tenders.ts`, `tests/split-sale-tenders.integration.test.ts`, next unapplied `migrations/0044_sale_tender_allocations.sql`; modify `server/modules/sales/types.ts`.

**Interfaces:** Add optional `PosSaleInput.tenders?: Array<{method:'Cash'|'Bank'|'Mobile Banking'|'Store Credit';amountCents:number;bankAccountId?:string}>`. Existing `paymentMethod` and `paidAmount` remain accepted for one-tender clients. Provide `validateTenderAllocation(input,grandTotalCents,customerId,accounts)` returning an immutable normalized allocation and due amount.

- [ ] **Step 1 — Failing tests**: Cash 2000 + Credit 3000 pays 5000 poisha; Bank 1000 + Mobile 2000 + Credit 2000 pays 5000; reject 5001, -1, NaN, fractional poisha, duplicate source ID, missing account, stale customer and nonexact net discount allocation. Preserve legacy single-tender behavior.
- [ ] **Step 2 — Run `node --import tsx --test tests/split-sale-tenders.integration.test.ts` and confirm FAIL**.
- [ ] **Step 3 — Add append-only tender allocations table and typed validator** using a fresh unique migration name and source-unique constraints.
- [ ] **Step 4 — Re-run tests; expect PASS**. Check migration on local D1 without using production credentials.
- [ ] **Step 5 — Commit** `feat(3g2-g): define immutable multi-tender allocations`.

### Task 5: Post mixed tender and due to their correct books atomically

**Files:** Modify `server/modules/sales/service.ts`; use `sale-tenders.ts` helper; extend `tests/split-sale-tenders.integration.test.ts`, `tests/store-credit-redemption.integration.test.ts`.

**Interfaces:** Consumes validated tender rows and existing `pos_sale_requests`. Produces one Sale invoice, ordered allocations, Store Credit `REDEEM` by exact customer, Cash and Bank/Mobile source-specific postings, optionally positive A/R for unsettled remainder. Source identity, amount and idempotency verified by DB constraints and service.

- [ ] **Step 1 — Write failing tests**: all-tender sum, cash/book matches only the cash component, bank balance only bank/mobile component, liability reduced only credit portion, new due positive only unpaid portion, FIFO stocked once; stale account, request-key replay with different allocations and concurrent last-credit checkout fail atomically.
- [ ] **Step 2 — Run tests to confirm FAIL**, then implement minimal D1 `db.batch` posting; do not accept credit+due until A/R settlement test is demonstrably green.
- [ ] **Step 3 — Inject failure in final `CREATE_SALE` audit and assert zero extra cash/bank, due, stock, invoice, tender or credit ledger entries.**
- [ ] **Step 4 — Run `node --import tsx --test tests/split-sale-tenders.integration.test.ts tests/store-credit-redemption.integration.test.ts`, then local Wrangler D1; expect PASS.**
- [ ] **Step 5 — Commit** `feat(3g2-g): post exact multi-source POS settlement`.

### Task 6: Source-faithful compact POS split-payment UI

**Files:** Modify `react-integration/overlay/src/integration/banijjApi.ts`, `LivePosPage.tsx`, `LiveCheckoutPanel.tsx`; extend `ui-checks/run.mjs`.

**Interfaces:** Sends `tenders` array from Task 4 and displays `paymentAllocations` returned by Task 5. UI may add/remove compact payment rows but must keep the original customer/cart/quantity and POS keyboard loop unchanged.

- [ ] **Step 1 — Before code, record the UI-consistency checklist** using `LiveCheckoutPanel.tsx` and current Party Ledger style as references; retain existing control heights, focus/error states, Bangla helper and dark mode.
- [ ] **Step 2 — Write failing Playwright checks** for multiple row add/delete, focus order, exact sum display, insufficient credit, account selection, mobile 390/tablet 768/desktop 1440 and no payment posted twice.
- [ ] **Step 3 — Run `node ui-checks/run.mjs` expecting FAIL** on a missing split-tender journey.
- [ ] **Step 4 — Implement UI without cart redesign**; payment errors must be explained in the existing checkout region; button disabled until the backend-valid allocation is ready.
- [ ] **Step 5 — Re-run `npm run react:build` and `node ui-checks/run.mjs` expecting PASS; attach screenshots and a11y results.**
- [ ] **Step 6 — Commit** `feat(3g2-g): compact bilingual split-tender POS` with UI parity review.

## Phase G2-H — Returns and invoice reversal of credit-paid sales

### Task 7: Credit reissue eligibility planner and append-only compensation

**Files:** Create `server/modules/sales/store-credit-reversals.ts`, `tests/store-credit-reissue.integration.test.ts`; modify `server/modules/sales/service.ts` and `routes.ts`, add new migration for allowed compensation source and event types.

**Interfaces:** `GET /api/sales-management/:invoiceId/credit-reversal-preview` returns original tender allocations, previously refunded amounts by method, net/remaining eligible value and supported choices. A verified `REISSUE` credit entry is a new immutable journal record, never removal of `REDEEM`.

- [ ] **Step 1 — Write failing tests**: full-credit sale returning 20 BDT restores exactly 2000 poisha liability once; 50/50 Cash+Credit sale returning half restores only bounded original credit portion; mixed-unit discounts, prior returns, serial/expiry and inactive customer return explicit unavailable reason rather than guess.
- [ ] **Step 2 — Run `node --import tsx --test tests/store-credit-reissue.integration.test.ts` expecting FAIL**.
- [ ] **Step 3 — Add source-verified compensating liability event and idempotent preview** with DB guard against fabricated source and over-restore.
- [ ] **Step 4 — Re-run tests plus `tests/store-credit-redemption.integration.test.ts`; expect PASS under full-migration and local D1.**
- [ ] **Step 5 — Commit** `feat(3g2-h): preview and guard Store Credit reissue`.

### Task 8: Correct partial/full return settlement and cash payout controls

**Files:** Modify `server/modules/sales/store-credit-reversals.ts`, `service.ts`, `tests/store-credit-reissue.integration.test.ts`, `tests/pos-mixed-return.integration.test.ts`, `tests/pos-bank-reversal.integration.test.ts`.

**Interfaces:** `POST /api/sales-management/:invoiceId/credit-reversal` with `{reason:string,refundAllocation:Array<{method:'Store Credit'|'Cash'|'Bank'|'Mobile Banking';amountCents:number;bankAccountId?:string}>,clientRequestId:string,items:ReturnLine[]}`. Only verified, authorized refund paths; source-specific caps; cash payout on a credit-funded original requires explicit approval/trace, never implicit substitution.

- [ ] **Step 1 — Write failing tests**: original credit+cash allocation 3000+2000 poisha and partial return 1500 cannot create more than 1500 of total liability/cash payout; repeat requests, wrong bank account, mixed unit prior returned, tracked warranty/expiry, stale balance and incompatible tender are all no-op 409.
- [ ] **Step 2 — Run tests and confirm FAIL** before enabling any UI refund option.
- [ ] **Step 3 — Implement atomic FIFO restoration, return/compensation, cash/bank refund and audit**. Include fault injection at final audit statement; assert 100% rollback on error.
- [ ] **Step 4 — Run `node --import tsx --test tests/store-credit-reissue.integration.test.ts tests/pos-mixed-return.integration.test.ts tests/pos-bank-reversal.integration.test.ts`; expect PASS, then D1/parallel request check.**
- [ ] **Step 5 — Commit** `feat(3g2-h): account for partial mixed-tender returns`.

### Task 9: Compact return UX for credit restorations

**Files:** Modify `LiveSalesReturnsPage.tsx`, `banijjApi.ts`, `ui-checks/run.mjs`; retain the existing return line table, serial picker and confirmation dialog.

**Interfaces:** Uses Task 7 preview and Task 8 POST. Displays original tender share, returned-to-credit amount, actual cash/bank refund and new customer credit, distinctly.

- [ ] **Step 1 — Re-read UI-consistency checklist** from `LiveSalesReturnsPage.tsx`; do not duplicate the full return workflow.
- [ ] **Step 2 — Write failing UI tests** for eligible credit-funded return, invalid legacy source, mixed-unit partial, refunded-before state and duplicate-confirmation prevention, with 390/768/1440 screenshots and a11y checks.
- [ ] **Step 3 — Run Playwright checks expecting FAIL**, implement the smallest preview/confirmation control, then rerun `npm run react:build` and `node ui-checks/run.mjs` expecting PASS.
- [ ] **Step 4 — Commit** `feat(3g2-h): show accountable credit restoration on Sales Returns`.

## Phase G2-I — Unified ledgers, reporting and full acceptance

### Task 10: Invoice payment provenance, customer ledger and audit reporting

**Files:** Modify `react-integration/overlay/src/components/brand/ReceiptPreview.tsx`, `react-integration/overlay/src/integration/banijjApi.ts`, relevant existing Party Ledger integration UI after inspecting its current route; modify `server/modules/sales/service.ts` read APIs. Add `tests/store-credit-reporting.integration.test.ts`, extend UI checks.

**Interfaces:** `GET /api/pos/invoices/:invoiceId` and customer credit account response expose immutable source-linked payment allocation, issue/use/restore history; customer A/R balance and liability remain separate. Invoice print shows exact real payment lines.

- [ ] **Step 1 — Write failing tests**: 3-method invoice prints exactly three tender lines; cash session equals Cash only; due ledger excludes Store Credit; full reissue history links to original invoice and return; financial review summary net equals total journal.
- [ ] **Step 2 — Run new tests expecting FAIL** before implementation.
- [ ] **Step 3 — Add read-model fields and compact interface/print mapping** without editing historical persisted amounts.
- [ ] **Step 4 — Verify `npm run backend:build`, `npm run react:build`, `node --import tsx --test tests/store-credit-reporting.integration.test.ts`, `node ui-checks/run.mjs`; expected PASS and no design regression.**
- [ ] **Step 5 — Commit** `feat(3g2-i): align credit invoice, ledger and financial reporting`.

### Task 11: Security/a11y/accounting release matrix and gated merges

**Files:** Modify `.github/workflows/hisabiq-react-build.yml` test list, `docs/superpowers/phase-3g2-release-acceptance.md`; create `docs/superpowers/reviews/<date>-store-credit-final-acceptance.md`.

**Interfaces:** Verification evidence includes per-run SHA, artifact URLs, cash/bank/due/liability zero-drift reconciliation, migration checks, independent reviewers, hosted preview and all draft PR dependencies.

- [ ] **Step 1 — Add all Phase F/I test files to CI** and assert backend full-migration + Worker/D1 + Playwright + axe run on latest relevant head; no skipped required test silently accepted.
- [ ] **Step 2 — Race/fault-injection test matrix**: duplicate/idempotency conflict, concurrent approval and spending, stale balance, audit write failure, original tender refund caps, serial/FIFO return.
- [ ] **Step 3 — Isolated hosted preview with explicit approval**: exact SHA, new Worker, distinct D1, isolated migration preflight, logged-in flows, 390/768/1440 screenshots and accessibility report. If skipped/unavailable, block release.
- [ ] **Step 4 — Independent financial and security signoff**: review original sale/return/cash/bank/accounting proof and unresolved legacy flags; `flagsTruncated=true` or unreviewed flags means no signoff.
- [ ] **Step 5 — Commit release dossier** and keep PRs draft unless all gates passed. Merge verified dependency stack in order, retarget child PR bases after each accepted merge. No production deployment as part of passing a PR check.

## PR Breakdown and Parallel Work

- **#18 → #19 → #20** remain existing prerequisites, never rewrite or force-push their reviewed accounting histories.
- Propose future **G2-F**, **G2-G**, **G2-H**, **G2-I** as **separate draft PRs** based on the previously accepted dependency, each with its own CI/artifacts. Do not share working branch or preview D1 with Phase 4 Purchase or Phase 5.
- Tests for UI can be developed in parallel with backend **only after** tender/return JSON contracts are fixed. Merging stays sequential because liabilities and settlement schema depend on prior phases.
- **Do not estimate time from phase count alone**; migrations, financial review and hosted environment authorization are external gates.

## Completion Definition

Full module is **complete** only when: historical issues have an explicit audit disposition (or remain blocked with no spendable effect), split tenders reconcile to one invoice in poisha, credit-funded returns/reversals work with source-bound compensation, invoice/ledger/reports show correct money sources, exact-head local + hosted checks pass, independent financial/security reviewers approve, and the stack is merged under repository protection. Otherwise the honest status is `implemented / CI green / release blocked`.

**Design approval required before implementing G2-F/I:** `docs/superpowers/specs/2026-10-30-store-credit-full-completion-design.md`.
