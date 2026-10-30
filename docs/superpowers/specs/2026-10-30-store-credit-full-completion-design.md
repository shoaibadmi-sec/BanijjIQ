# HisabIQ Store Credit — Full-Completion Design (Proposed)

**Date:** 2026-10-30 (Asia/Dhaka)
**Status:** PROPOSED for review. Extends the approved narrow G2 accounting contract; it does **not** authorize a merge, Worker deployment, production D1 migration, or unsafe legacy balance conversion.
**Repository:** `shoaibadmi-sec/BanijjIQ`
**Current stack:** HisabIQ React + shadcn/Tailwind compact bilingual UI, Hono API + Cloudflare Worker/D1, GitHub-only PR workflow.
**Existing specifications:** `docs/superpowers/phase-3g2-store-credit-accounting.md` and `docs/superpowers/phase-3g2-release-acceptance.md`.

## Goal and why

Complete customer Store Credit as a trustworthy, distinct liability through issuance, historical case reconciliation, mixed-tender redemption, subsequent sale returns/reversals, customer ledger/invoices, business reporting, and audited release acceptance. A hardware-shop cashier must be able to use credit without learning accounting jargon; the business must never silently lose money or double-pay.

## What exists, as verified on 2026-10-30

- G2-A: integer-cent append-only `customer_store_credit_entries`; separate `customer_store_credit_balance`; migration 0039.
- G2-B: cash-source-verified credit issuance in sales returns, atomic FIFO/return/journal batch; migration 0040.
- G2-C: guarded full-credit-only POS redemption with idempotency, adequate balance, and no invented cash/bank receipt; migration 0041.
- G2-D: bilingual POS/Returns credit UI and read-only per-customer history.
- G2-E partially: admin-only `GET /api/pos/store-credit/reconciliation` and bounded, D1-compatible anomaly detection; full-migration SQL tests and local Worker/D1/Playwright CI. The latest reviewed commit before this proposal was `08be44568c12e12dce125861747453cd1f7baa2f` with GitHub Actions `41004058679` **success**. Hosted acceptance still not done.
- Stacked draft PRs: #18 (bank/mobile reversal) → #19 (due reversal) → #20 (Store Credit). All were open, draft, unmerged when checked. Ordinary PR hosted-preview deploy/accept jobs are skipped by design.

## Recommended scope: five remaining phases

| Phase | Outcome | Prerequisite | Acceptance owner |
| --- | --- | --- | --- |
| **G2-E** | Accept and safely release the existing restricted workflow | Current draft stack, exact-head CI | Human finance/security + hosted-preview reviewer |
| **G2-F** | Audit and resolve historical credit anomalies with explicit source evidence | Read-only reconciliation report | Finance administrator |
| **G2-G** | Credit + Cash/Bank/Mobile split tenders; optionally partial settlement/due, with precise allocations | Append-only liability plus accepted reconciliation semantics | POS/accounting reviewer |
| **G2-H** | Credit-funded return/refund/reissue and invoice reversal with compensating events | G2-G tender provenance and source-linked return engine | Finance/accounting reviewer |
| **G2-I** | Unified balances, invoice/party-ledger and reporting UX, role controls, full release audit | G2-F, G2-G and G2-H | Business release approver |

**Count:** For the originally approved G2-A…E minimal version, only **G2-E acceptance** is left. For the **advanced full Store Credit module**, there are **five phases: E through I**. Counting a phase as fully done requires its acceptance criteria, not just merged code.

## Architecture choices considered

1. **Keep single-payment Store Credit only.** Lowest risk and quickest release, but it does not satisfy approved multiple-payment, returns and settlement workflows.
2. **Extend Store Credit inside the existing `sales.payment_method` column.** Fewer migrations, but cannot faithfully represent multiple tenders or independently reverse their portions. **Rejected**.
3. **Recommended: add an explicit per-sale tender allocation ledger; keep the current sales columns for legacy compatibility; evolve the separate liability journal with source-verified compensating events.** Moderate extra schema/tests, but source provenance, D1 atomicity, refunds, cash/bank reporting and invoices are auditable.

This third option is **proposed**, not yet explicitly approved for advanced phases. Keep original UI appearance; change only the necessary payment/return controls.

## Data and behavior boundaries

- Receivable: `customers.current_due`, `customer_ledger`. Store Credit: *liability*, strictly separate.
- Amounts: input API may accept decimal BDT, but normalize each tender to signed/unsigned integer **poisha** for accounting; reject non-finite, negative, excess or fractional-poisha submissions; detect rounding drift at invoice totals.
- Current `sales.payment_type` and `payment_method` remain readable by old invoices. **New source of truth** for advanced mixed transactions is per-sale immutable tender rows. Never manufacture a cash-book deposit from credit.
- New future migration filenames must start **after the current maximum applied migration**. Never edit 0039/0040/0041 or reuse a historically applied migration name. The prior proposed 0042 view was removed after Wrangler incompatibility; verify migration inventory before numbering.
- `pos_sale_requests` retains exact-payload hash idempotency; every change to tender allocation must be included in fingerprint. A replay with changed tender, amount or customer fails 409 and changes nothing.
- One complete D1 batch covers invoice, sale items, stock/FIFO, tender allocations, cash/bank journal, Store Credit journal, receivable ledger and audit. Conflicts must roll back the entire batch.
- Existing credited customer ownership and live balance validation remain server-authoritative. Expired/inactive/deleted customer, legacy unresolved records or stale balance fail closed.
- The old fully credit-funded sale cannot be normally edited, deleted or cash-refunded until G2-H establishes an audited compensating path.
- No Redis, Postgres, new UI framework, new independent frontend app or raw SQL migrations from the browser.

## G2-F: Historical reconciliation contract

Create a **case**, not an automatic balance migration, for each `LEGACY_UNJOURNALED_RETURN`, `LEGACY_RECEIVABLE_CREDIT`, `NEGATIVE_RECEIVABLE`, or mismatched source. Link the original sale, return, cash/bank receipt and historical receivable adjustment; capture actor, date, explicit reason, evidence references and financial impact preview. Cases stay blocked if there is no proof the liability is outstanding or already settled. After a separately authorized resolution, post only an **append-only, source-linked compensating event** with unique case key and coherent receivable adjustment where economically required; mark the case resolved in the **same batch**. No silent opening credit, no destructive row rewrite, no auto approval. Small shops can use an admin plus explicit confirmation; provide optional second reviewer when a distinct authorized role exists.

## G2-G: Split-payment contract

API accepts an explicit allocation list, for example `tenders: [{method:'Store Credit',amountCents:3000},{method:'Cash',amountCents:2000}]` for a BDT 50 invoice. Bank/Mobile rows require active account IDs. Store Credit requires matching saved customer and sufficient verified balance. Sum of all tenders plus new due must equal invoice net total exactly; refuse overpayment/change rather than silently modifying totals. Cash-book records only Cash, bank-book records only Bank/Mobile; a single Store Credit redemption reduces liability once. Support multiple rows, with unique row IDs and invariant checks; invoice print distinguishes the payment sources. Maintain one-tender API behavior for existing clients.

Due/partial settlement is a **sub-gate** within G2-G because it changes A/R accounting. Do not allow credit + due unless full reconciled settlement and ledger tests pass. Split among cash and bank/mobile without credit can be implemented with the same tender engine if accounting tests prove no side effects.

## G2-H: Returns/reversals contract

For a sale paid partly or entirely with Store Credit, each return/refund must refer to original tender allocation and original discounted unit value and remaining returnable quantity (including mixed-unit snapshots). Default to restoring the unused credit-funded share into Store Credit with a *new source-linked compensating entry*, not deleting the original REDEEM. If any cash/bank payout is offered, it must be a separately authorized and auditable explicit refund choice with a source-of-funds ledger posting and no double-refund. Partial and full return of a split-tender invoice cannot refund more than cumulative net paid value. Preserve FIFO lot, serial, expiry and warranty constraints, and prevent repeated returns/reversals. Block any combination that cannot be provably reconciled.

## G2-I: UX, ledger and release contract

- Reuse **exact HisabIQ React** `LiveCheckoutPanel`, `LivePosPage`, `LiveSalesReturnsPage`, Party Ledger compact visual rules, dark-mode focus/contrast, touch/keyboard and bilingual labels. Never redesign the product/cart or switch Vue.
- Customer balance displays **Due / বাকি** and **Store Credit / জমা ক্রেডিট** as separate rows. Show allocations and issue/redeem/restore history with invoice source links; do not mislabel credit as cash received.
- Product tables and party ledgers continue their approved compact behavior; use existing table-column controls for journal detail where useful.
- Customer ledger, daybook, cash session and printed invoice reconcile to tender allocations. Privileged audit review remains accessible only to authorized personnel; regular cashier gets simple valid choices, not raw accounting corrections.
- Run full-migration tests, isolated Worker+D1, Playwright at 390/768/1440 px, a11y, concurrency/race tests, and real *isolated hosted* preview acceptance. Keep existing production routes/data off limits before a signed review.
- Preserve GitHub-only draft PRs, gated merges in dependency order, independent financial/security reviewer, exact reviewed SHA and before/after D1 migration verification.

## Negative scenarios to prove

1. Two checkouts redeem the same remaining Store Credit simultaneously: exactly one succeeds; the other has zero side effects.
2. A historical negative customer due appears alongside positive Store Credit: no automatic conversion or double-settlement.
3. Rounding a mixed-unit return and splitting Cash + Credit: the sum of tender/refund minor units matches the exact invoice/return amount.
4. Original Cash and Bank/Mobile receipts plus a Store Credit liability: partial/full reversal restores only what that tender paid, once.
5. Duplicate client request or reconciliation case: 409 without a duplicate invoice, cash/bank entry, stock movement or credit liability event.
6. A mismatched customer, inactive account or unsupported mixed-source return: 409, no side effects.
7. A failed final audit write: entire stock, tender, receivable, cash/bank and liability batch rolls back.

## Approval boundary

This file is a **proposed design** for completing the *advanced* Store Credit module. Phase G2-E is already specified and implemented to local CI; G2-F/I extend the original scope. Review/approve the proposed architecture, especially **historical compensating entries** and **partial credit + due**, before coding new product behavior. A planning document can be prepared now; implementation awaits approval.