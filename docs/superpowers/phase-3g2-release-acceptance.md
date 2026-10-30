# Phase 3G2-E — Store Credit financial release acceptance

**Scope:** `shoaibadmi-sec/BanijjIQ`, stacked draft PRs #18 → #19 → #20.
**Status:** NOT approved for production or automatic merging. Latest-head GitHub Actions pass is necessary but not sufficient.

## 1. Independent read-only liability reconciliation

After applying migrations 0039–0042 **only to an isolated review D1**, authenticate as an ERP administrator and call:

```text
GET /api/pos/store-credit/reconciliation
Authorization: Bearer <administrator token>
```

This **GET-only** response reports `issuedCents`, `redeemedCents`, `outstandingCents`, `journalEntries`, `customerAccounts`, `reviewRequired`, `flagsCount`, `flagsTruncated`, and at most 100 anomaly rows. All money is integer cents; review against the original sales invoices, cash receipts, returns and journal entry IDs.

**Expected source invariants:**
- Every `ISSUE` has an authorized original fully paid **cash** sale, valid `Store Credit` return and matching return-item amount; the payment was never cash-refunded a second time.
- Every `REDEEM` has one exact-amount full-credit POS sale, a linked active customer, and no bank/cash receipt or customer A/R entry.
- Customer due and Store Credit liability remain **two separate balances**; negative receivables and pre-0039 `Sales Return Credit` ledger offsets must be reviewed, never silently transferred into spendable credits.
- Total issued minus total redeemed equals outstanding **without a negative balance**. No credit sale may be unjournaled.
- Historical discrepancies must be audited by a human accountant, with original invoice, return, customer identity and source cash ledger. Do not automatically create entries to make a report look clean.

**Flag meanings:**
- `LEGACY_UNJOURNALED_RETURN`: old Store Credit return without an issue journal.
- `LEGACY_RECEIVABLE_CREDIT`: old receivable offset incorrectly presented as Store Credit.
- `NEGATIVE_RECEIVABLE`: potentially conflated or otherwise negative customer A/R.
- `ISSUE_SOURCE_MISMATCH` / `REDEMPTION_SOURCE_MISMATCH`: recorded liability no longer matches its source.
- `CREDIT_SALE_WITHOUT_REDEMPTION`: credit tender posted without equal journal debit.
- `CREDIT_SALE_HAS_CASH_RECEIPT` / `CREDIT_SALE_HAS_BANK_RECEIPT`: false cash/bank effects on credit tender.
- `NEGATIVE_LIABILITY`: net journal below zero, unsafe for spending.

`flagsTruncated=true` means more than 100 rows; the API summary is **not** an exhaustive export. Do not treat incomplete evidence as sign-off.

## 2. GitHub and hosted preview acceptance

1. Verify exact reviewed head SHA for **each** of draft PRs #18, #19 and #20, in dependency order.
2. Require all local backend accounting, Worker/D1, React compilation, browser Playwright, and axe accessibility checks **passed** on that exact head; do not rely on an earlier green run.
3. Hosted Cloudflare visual/a11y acceptance must be **independently authorized** for a separate preview Worker and **distinct preview-only D1**. Current workflow deploy/accept jobs are deliberately skipped for ordinary PRs; never mark skipped as passed.
4. Compare hosted screenshot evidence at mobile/tablet/desktop sizes with the original compact HisabIQ React design. Recheck bilingual due versus credit labels, selected customer identity, issue/redeem confirmations, saved invoice, and printed payment method.
5. Independently verify D1 migration inventory and historical reconciliation on isolated review data before deciding whether to release. Never target production DB or change branch protection to expedite a draft.
6. Record the human financial/security reviewer, review date, exact SHA, isolated preview URL, and artifact links in the PR before marking ready/merging. All discrepancies must be resolved with a separately reviewed corrective migration or auditable business workflow, **not** an automatic account adjustment.

## 3. Non-supported workflows — stay blocked

- Split-cash/credit tender, mixed due/credit settlements, partial bank/mobile reversals, and non-cash refunds on credit-paid sales.
- Deletion/editing of a credit-funded sale without separate audited liability reissue/reversal logic.
- Auto-conversion of historical negative customer dues to positive Store Credit.
- Any automatic merge or remote D1 migration that bypasses review and isolated-preview approval.

**Deployment status:** no production D1 changes, Worker deploy, or merge are authorized by this checklist.
