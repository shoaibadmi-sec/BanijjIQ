# Correct Mohim ERP reference — Hono parity audit reset

**Date:** 2026-10-28. **Status:** source correction and preliminary cross-repository feature triage; no application implementation in this PR.

## Authoritative reference

- **Source of truth:** [`shuvodelux-commits/Mohim_ERP`](https://github.com/shuvodelux-commits/Mohim_ERP) `main` at commit [`f95be8d9bcf55b08abe8841e7502d27b23c82c4c`](https://github.com/shuvodelux-commits/Mohim_ERP/commit/f95be8d9bcf55b08abe8841e7502d27b23c82c4c), dated **2026-10-24**.
- **Incorrect reference used previously:** `shuvodelux-commits/sherERP_Mohim` `main` at `590adfad128fe7155bfb7b608a2ed5665b202a9c`, dated **2026-10-12**.
- **Hono target:** `shoaibadmi-sec/BanijjIQ` `main` at `e5825b3219201c67e4ad1574c5f6e9f2c2a6830e`. Existing Cloudflare Worker: `shererp-new`, D1: `shererp-new-db`.

The repositories have substantial shared lineage but are **not a linear newer/older pair**. A local source-tree comparison (excluding `.git`) found **164 byte-identical shared files, 84 changed shared files, 45 correct-reference-only files and 24 wrong-reference-only files**; the latter count includes the parity-upload scratch files created during the audit. The official `Mohim_ERP` currently has **137 test files under `tests/`**, compared with 115 in the old reference.

## Verified differences that materially change implementation priorities

| Priority | Area / source evidence in `Mohim_ERP` | Current Hono status / work needed |
|---|---|---|
| P0 | **Virtual product bundles**: `Bundles.gs`, `docs/superpowers/specs/2026-10-13-virtual-product-bundles-design.md`, multiple `tests/bundle_*.test.js` | **Missing** bundle type/recipe/version, per-component FIFO stock movements, bundle invoice as one line, reversals, returns, drafts, profit/report linkage. Needs an independent schema + accounting design and atomic D1 batch testing |
| P0 | **Independent Finance Person Ledger**: `financePersonLedger.html`, `docs/superpowers/specs/2026-10-14-finance-person-ledger-independent-workspace-design.md`, `FinanceModule.gs`, related tests | **Partial** generic finance tables exist, but not this approved two-pane people/ledger workspace, role-based signed balances, read/detail/edit modal flow, mobile list-first and keyboard navigation |
| P0 | **Ledger credit/debit semantics and color rules**: Oct 24 commits `44ea844`, `f95be8d`; `financeLedger.html`, `customerLedger.html`, `supplierLedger.html`, `docs/erp-semantic-balance-card-audit.md` | **Partial**. Map actual money-in/money-out and balance meaning per ledger **before** adding colors or reordering columns; no misleading labels for unpaid sales/purchases |
| P1 | **Purchase searchable supplier picker and visible due balance**: Oct 15 PR #26, `purchase.html`, `tests/purchase_supplier_balance_combobox.test.js` | **Partial**. Replace bare select with keyboard-friendly search/selection, current supplier balance and consistent ledger links |
| P1 | **POS V2 standardization / removal of Classic POS paths**: `posv2.html`, `tests/pos_v2_only_sales_workflows.test.js` | **Partial**. Test edit/duplicate/open from Sales/Drafts all load the same POS V2 with full cart/customer/prices/notes; no reduction of existing Hono functionality |
| P1 | **Finance opening cash baseline and role-aware balances**, `CashReconciliation.gs`, `FinanceModule.gs`, `tests/historical_opening_cash_baseline.test.js` | **Partial**. Audit history vs cash-session boundary and prevent opening balance from being double-posted into session movements |
| P1 | **Customer/supplier/vendor ledger semantic summaries**, `tests/customer_supplier_ledger_semantic_colors.test.js`, `tests/party_ledger_color_ui.test.js` | **Partial**. Source-linked balances with debit/credit meaning, correct negative balances, high-contrast compact bilingual UI |
| P2 | **No monospaced financial typography**, `tests/no_monospace_typography.test.js`; responsive/mixed-device UI tests | **Not fully aligned**. Inspect Hono `mono` classes and typography; preserve readable figures without using monospaced numbers |
| P2 | **Newest-first master lists, zero numeric input handling and semantic cards**, `tests/master_lists_newest_first.test.js`, `tests/zero_numeric_entry.test.js`, `docs/erp-semantic-balance-card-audit.md` | **Partial**. Add small, isolated regression-tested UX changes after core financial invariants |

### Important feature divergence

The **older but different** `sherERP_Mohim` branch includes `ProductUnitConversions.gs`, `priceUnitId`, `Stock Entry Unit`, optional unit-symbol handling, and whole-Taka `Rounding Adjustment` tests. **These are not present in the designated `Mohim_ERP` source at `f95be8d`**. They might still be desired features, but **they must not be represented as source-faithful ports of the authoritative repository**.

Draft [BanijjIQ PR #2](https://github.com/shoaibadmi-sec/BanijjIQ/pull/2) was consequently labeled **ON HOLD — do not merge**. Its unit-symbol implementation and financial direction styling need independent review and re-scoping; do **not** promote or migrate `0028_unit_symbols.sql` just because the test passes.

## Corrected implementation plan

1. **Detailed functional parity inventory (read-only):** confirm the approved bundle rules, POS V2 context transitions, Finance Person Ledger view and accounting semantics using source implementations and relevant regression tests. Identify existing Hono functionality and dependencies.
2. **Module-by-module Hono design:** formal SQL migrations (additive only); reference integrity; atomic stock/lot/ledger posting; authorization; audit records; versioned bundle recipe; UI behaviors. Preserve all existing real D1 records.
3. **Bundle feature branch first:** bundle master and component mapping, no nested bundles, fixed independent bundle sale price, per-component stock, bundle as one invoice item, partial-return restrictions, reversal and reporting parity; test on a temporary D1 clone, never real sales in production.
4. **Finance Person Ledger branch:** signed borrower/lender/owner balances, view/edit/remove through existing authorized transactions; two-pane desktop and list-first phone UX; source-row drill-down.
5. **Ledger semantics + purchase supplier search + POS V2:** separately reviewed small pull requests; carry over official `Mohim_ERP` tests as platform-agnostic behavior specs, not Google Sheets code.
6. **Release gates:** front-end TypeScript build; Hono backend typecheck; D1 in-memory + local runtime migrations; accounting invariants with negative/reversal cases; accessibility and mobile review; non-production deployment and real D1 backup; **explicit** production promotion only.

## Production protection

- **Do not** directly copy Apps Script `.gs` or Sheets writes into Hono services.
- **Do not** deploy unfinished accounting features or migrate production D1 while reviewing the source.
- Keep Cloudflare Builds at `npx wrangler versions upload` until approved.
- Production Worker `shererp-new` and production D1 `shererp-new-db` remain untouched during this source correction.
- `main` is the source of truth for the existing Hono code; this document PR is **documentation-only**.
