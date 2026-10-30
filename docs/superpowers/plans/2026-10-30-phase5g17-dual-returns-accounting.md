# Phase 5G17 — dual-source purchase and sale returns, paid bank purchase reversal

> Superpowers / Ponytail implementation plan. Branch off currently merged `main` after Phase 3G2-M and Phase 4I-C3. Keep Phase 6 Finance and remaining Phase 3/7 drafts isolated.

## Objective
One real authenticated Hono → fully migrated, disposable SQLite (D1-compatible) acceptance covers **paid bank purchase, cash FIFO sale, partial cash sales return, paid bank purchase refund, and supplier refund reversal**. Existing per-module tests do not verify the combined closing balances and profit/stock reporting. This is a test-first characterization; no speculative production code.

## File ownership
- New `tests/reports-dual-return-accounting.integration.test.ts`: one realistic end-to-end source, party ledger, bank/cash, FIFO and report reconciliation test.
- Change `.github/workflows/hisabiq-react-build.yml` only to include the test in required CI.
- This plan is design/audit context; no UI, schema, production code or dependency changes unless a real failing invariant proves necessary.

## Step-by-step
1. Create admin+supplier+product via real authenticated API; create a bank with BDT500 opening. Open a cash session.
2. Bank-pay entire purchase: 10 pieces × BDT20 = BDT200; bank remaining 300, supplier due 0, stock 10 from original-cost FIFO lot.
3. Cash-sale 4 pieces at BDT35 = BDT140; original cost BDT80. Return 1 sold piece at BDT35 cash (net sold3, FIFO cost60, net sales105).
4. Return 2 unsold purchased pieces for original BDT20 each, paid bank refund BDT40; bank goes 340 and FIFO stock drops from7 to5. Refund must not create supplier due.
5. Reverse that specific bank refund with same one-time request ID; verify money-book reversal debit BDT40 restores bank to300, original refund book and return source retained but status Reversed, purchase returned_amount=0, stock and lot return to7, supplier due stays0.
6. Run reports `profit`, `stock`, `receivables`, `payables`, `cash`, `bank`: netSales10500, fifoCogs6000, profit4500, inventory14000, no supplier due, no receivables, cash receipts14000/payments3500/book10500, bank receipts4000/payments24000/balance30000, external net movement -9500, no operating expenses. Reports must not mutate data.
7. Replay refund reversal same request (idempotent), retry different request (409) and verify all bank/cash/stock/ledgers unchanged. Test actual source identities, not only reported totals.
8. **TDD:** commit test and observe exact-head CI first (RED if genuine accounting defect, GREEN if existing behavior correct). On RED, inspect source-of-truth events and apply minimal shared fix, then rerun focused + full CI. On initial GREEN, keep tests-only scope.
9. Full backend/React/Playwright/axe/local isolated Worker+D1 CI required on the **exact final PR head**. Review diff and squash merge only after all required checks pass. Never deploy hosted/prod or apply remote migrations.

## Known limits
Unmerged Phase 6 expense/daybook and some Phase 3 UI scenarios are not certified by this slice. Reports must fail closed for unknown source accounting rather than manufacture complete audit evidence.
