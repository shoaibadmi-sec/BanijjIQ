# Phase 5G18 — Finance, operating expense and internal bank transfer reporting acceptance

> Superpowers/Ponytail test-first plan; follow root AGENTS.md; current merged main only. Phase 6 Daybook PR #39 and Phase 6A–6I PR #28 remain unmerged.

## Objective
One authenticated Hono/SQLite fully migrated integration scenario tests finance and expense postings *alongside* a real FIFO cash sale, and two real bank accounts with an internal bank transfer. Verify source cash/bank books, balance snapshots, exact report metrics and that equity/loan/transfer are not revenue.

## Transactions and independent expected poisha
1. Setup admin, POS cash session, Bank A opening **BDT500**, Bank B opening **BDT100**, finance person Owner, finance person Lender, expense category.
2. Owner Investment **BDT200 Cash**, Loan Received **BDT300 Bank A**.
3. Bank internal transfer **BDT120** A→B, with two genuine bank_book legs and one bank_transfers header. This is NOT income or business profit.
4. Operating expenses **BDT40 Bank B** and **BDT30 Cash**, with source expense rows and money journals. Source Bank B closing BDT180; Bank A BDT680; Bank total BDT860.
5. Produce one original-cost opening-stock product: **2 × BDT20 FIFO cost**. Cash POS sale **2 × BDT50 = BDT100**. Net gross profit BDT60; operating expenses BDT70; net profit **−BDT10**.
6. Cash book receipts BDT300, payments BDT30, ending book BDT270. Bank book receipts BDT420, payments BDT160, net bank movement BDT260. Bank snapshot total BDT860. Internal transfer volume BDT120; external net movement BDT530. Owner capital in BDT200; financing loan receipt BDT300 but not ownerCapitalIn or sales.
7. Verify `profit|expenses|finance|cash|bank|stock` report metrics/rows from real APIs, source IDs for all, no writes, and bank transfer source legs. Assert report coverage does not pretend full ledger certification.
8. Fail-closed check: inject a mismatched extra bank transfer leg in disposable DB, then verify cash/bank/finance report total metrics become null and coverage 'incomplete' rather than invent trusted totals; no posting changes.
9. First commit **test only**, attach to mandatory CI; wait for genuine RED or existing GREEN. On RED, diagnose and minimally fix only verified issue (Ponytail); if existing behavior passes, retain test-only characterization.
10. Require full exact-head GitHub Actions backend, finance/purchase/accounting suite, React, Playwright/axe and disposable Worker/D1 GREEN before review/squash merge. No remote DB migrations or hosted/production deployment.

## File scope
`tests/reports-finance-transfer-lifecycle.integration.test.ts`, one CI test invocation in `.github/workflows/hisabiq-react-build.yml`, and this plan only. No Phase 6 Daybook assumptions or unmerged feature work.
