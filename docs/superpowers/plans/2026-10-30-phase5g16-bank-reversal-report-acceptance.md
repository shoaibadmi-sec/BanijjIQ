# Phase 5G16 — Supplier bank settlement reversal + customer collection report reconciliation

## Sources and constraints
- Source-of-truth: current merged `main`, not ongoing unmerged Phase 3 partial split refunds, Phase 4 purchase refunds or Phase 6 finance branches.
- Proven main services: `server/modules/purchases/supplierSettlement.service.ts`, `server/modules/sales/service.ts`, `server/modules/reporting/live/{cash-expenses,stock-dues,sales-profit}.ts`.
- This independent vertical slice adds genuine authenticated Hono + fully migrated SQLite/D1-compatible acceptance, not new product features.
- Core goal: prove both the outgoing supplier bank settlement and the compensating bank reversal remain **traceable**, and the reversal is *not* revenue/profit, especially when the same bank has already received customer dues.

## RED/GREEN workflow
1. **Test first**: build fixture using real handlers and all migrations, source rows, supplier purchase of 10 units BDT20, cash session, due sale of 4 units BDT35, bank account opening BDT1000, customer bank payment BDT90 and supplier bank settlement BDT50.
2. Confirm pre-reversal bank BDT1040; supplier due BDT150; customer due BDT50; report cash/bank/profit/stock/payables/receivables consistency, FIFO COGS BDT80, profit BDT60, physical stock6 valued BDT120.
3. Reverse exactly the supplier BDT50 settlement through the authenticated route. Confirm original entry status Reversed, **one** compensating bank credit BDT50, original supplier debit BDT50 preserved, master bank BDT1090, supplier due BDT200, supplier ledger BDT200 and customer due BDT50 unchanged. Bank report receipts BDT140 (customer90 + reversal50), payments BDT50, external net BDT90; no cash money-book entries. Profit still BDT60 (financial reversal does not create sales) and inventory unchanged.
4. Try duplicate reversal; assert 409, no additional bank/source money, supplier due/ledger or journal changes.
5. Verify all Phase 5 live reports remain read-only and required coverage truthfully indicates `ready` or source-limited status. Avoid asserting audited full double-entry if unavailable.
6. **TDD decision:** commit and run new test before modifying production. If it fails, diagnose root cause first, keep original RED evidence, change smallest shared source and verify GREEN. If passes, preserve test-only characterization (no fabricated RED).
7. Wire the test into the mandatory GitHub Actions backend suite. Require **exact-head full** backend/Phase4/React/Playwright/axe/isolated Worker+D1 GREEN and PR review before squash merge. No remote migrations or hosted/production deployments.

## Accounting expectation (poisha)
- Sales BDT140; FIFO COGS BDT80; net profit BDT60
- Inventory 6 × BDT20 = BDT120
- Customer remaining receivable BDT50
- Supplier payable restored BDT200 after reversal
- Bank current balance BDT1090 = opening1000 + customer90 - supplier50 + reversal50
- Period bank receipts BDT140, payments BDT50, external net BDT90
- Never double-post on reversal replay; reports must not write.
