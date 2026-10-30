# Phase 5G19 — expense edit/cancel and financial report source reconciliation

## Existing main; architecture
Merged main supports authenticated expense POST/PUT/cancel, owner finance, FIFO POS sales, and live reports `profit|cash|bank|expenses|finance`. Source `server/modules/reporting/live/cash-expenses.ts` currently selects only active expenses and flags any `Expense` book posting without an active expense ID as an orphan. Cancellation legitimately keeps immutable original `Expense` debit and adds `Expense Deleted` credit; therefore valid cancellations likely mark all money reports incomplete. This is a specific reporting bug to prove with RED.

Unmerged Phase 6 #28/#39 Daybook/Finance UI and Phase 3/7 remain untouched. Use existing React unchanged.

## Task 1: executable RED test before production change
Add `tests/reports-expense-cancellation-lifecycle.integration.test.ts` with authenticated real Hono handler and fully migrated disposable SQLite.
- Cash session, Bank opening BDT200; 2-piece FIFO cash sale 2 × BDT50 from original stock cost BDT20 (BDT100 revenue, BDT40 COGS).
- Cash expense BDT30 → edit Cash BDT40 → cancel BDT40; book legs −30 −10 +40; net zero.
- Bank expense BDT25 → edit Bank BDT35 → cancel BDT35; bank legs −25 −10 +35; bank recovers to opening BDT200; no active expense or operating cost from cancelled source.
- Active Cash expense BDT15 remains; Owner Investment BDT200 Cash, Loan Received BDT100 Bank.
- Expect profit 100 −40 −15 = **BDT45**; bank 300; inventory BDT20; cash book 100−15+200=285; source payment and reversal rows remain immutable, cancellation audit exists.
- Report source date window 2026-01-01..2026-12-31; `cashReceipts=BDT340`, `cashPayments=BDT55`, `bankReceipts=BDT135`, `bankPayments=BDT35`, `bankCurrentBalance=BDT300`, `operatingExpenses=BDT15`, `ownerCapitalIn=BDT200`, `netProfit=BDT45`, all in exact integer poisha. All reads no writes. Cash coverage `needs-review` and profit `ready`.
- **Negative**: corrupt one cancelled expense reversal by BDT5; report must fail closed (coverage `incomplete`, money and expenses metrics null), rather than trust a forged cancellation. Repeated cancel must fail without any new ledger or audit writes.
- Mandatory CI backend test first on exact head should show RED, saved logs.

## Task 2: minimal GREEN
Fix only `server/modules/reporting/live/cash-expenses.ts` to read the underlying expense source for both active and cancelled records. Verify the exact net cancellation from original `Expense`, `Expense Update` and `Expense Deleted` legs; canceled sources contribute **zero** operating expense, without permitting missing/altered originals. For active sources prove net matches current amount and valid payment side. Do not change posting semantics, schemas, auth, UI, or daybook.

## Task 3: full review and merge gate
Full exact-head GitHub Actions: backend+accounting function tests, isolated SQLite/D1, React build, Playwright/a11y, Worker+D1 browser 14/0. Merge only if final exact head completed `success`, diff reviewed and approvals/required rules satisfied. Hosted/production deployments and remote D1 migrations on HOLD.
