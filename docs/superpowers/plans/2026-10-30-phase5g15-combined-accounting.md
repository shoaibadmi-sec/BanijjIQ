# Phase 5G15 — Combined receipts, supplier bank settlement, stock and reporting acceptance

> Execute via Superpowers TDD/Ponytail, following the root AGENTS.md contract. Preserve Phase 3/4/6 open branches and React UI.

## Architecture and scope
Use the **real authenticated Hono handler** and **fully migrated disposable SQLite/D1-compatible DB**. Confirm the currently merged Phase 4 supplier-settlement and Phase 5 cash/bank/customer collection services interact correctly with sales FIFO and live reports. Do not merge unready Phase 3 refunds, Phase 4 paid-purchase refunds, or Phase 6 Finance. No migrations, UI, dependencies or remote Worker changes.

## Task 1 — Define and execute deterministic test FIRST
- Create supplier purchase 10 × BDT20 on credit; creates original FIFO lot and payable 200.
- Open cash session. Post an entirely unpaid sale 4 × BDT35 (receivable 140, profit 60 on frozen FIFO cost 80).
- Seed only an isolated active Bank account with opening 1000. Receive BDT90 of customer due into bank (receivable 50, bank 1090). Attempt over-collection to prove fail-closed with no side effects.
- Inject bank-book SQL rejection on supplier settlement and prove **all** supplier, bank and ledger changes rollback. Remove trigger; settle BDT50 of supplier payable from the same bank (bank 1040, payable 150).
- Receive remaining BDT50 customer due in cash; make another cash sale of 1 × BDT35 (cash receipt total 85, receivable 0, physical stock 5).
- Assert source customer and supplier ledgers, exact cash and bank journal directions, frozen FIFO COGS, stock lot quantity, report receivables/payables/stock/profit/cash/bank values, no report writes.
- Replay supplier settlement/sale request to prove no extra money/stock transaction; rejection of duplicate over-collection.
- Test all values in integer poisha (expected net sales 17500, FIFO COGS 10000, net profit 7500, stock value 10000, bank snapshot 104000, customer due 0, supplier payable 15000).

## Task 2 — RED/GREEN decision
- Commit the executable test to isolated branch and run full CI for **test-first** evidence.
- If a business invariant fails: trace the root cause, retain RED run, fix shared handler minimally, then prove GREEN and all prior accounting suites.
- If all existing behavior passes: retain this **test-only characterization** rather than fabricating RED or changing production unnecessarily (AGENTS.md exception for test-only acceptance).

## Task 3 — mandatory merge gate
- Full CI on exact head: TypeScript backend, function/transaction tests, React build, Playwright/axe, real isolated Cloudflare Worker/D1 and reports. Read outcome and logs.
- Review patch; only merge green clean PR with exact-head evidence. Keep production/hosted deployments on HOLD; source incomplete reports remain fail-closed.
