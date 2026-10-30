# HisabIQ Phase 4F — TDD function and accounting transaction coverage

**Scope:** the Phase 4 Purchase & Supplier backend in `server/modules/purchases/`, including its authenticated Hono routes and real SQLite/D1-compatible migrations. All changes use Ponytail's minimal implementation rules, with RED → GREEN regression checks for defects.

## Function/route coverage inventory

| Boundary / functions | Exercised by | Assertions |
| --- | --- | --- |
| `searchPurchaseSuppliersRoute` | `phase4-purchase-supplier.integration.test.ts` | Auth, name/phone/id, inactive filtering, due reconciliation, read-only calls |
| `createSupplierRoute`, `getSuppliersPageRoute`, `updateSupplierRoute`, `getSupplierDetailRoute`, `setSupplierStatusRoute`, `deleteSupplierRoute` | `phase4-transaction-contracts.integration.test.ts` and `phase4-purchase-supplier.integration.test.ts` | Duplicate/invalid names, status validation, opening balance with cash-session requirement, due-related deletion guard, audit |
| `createPurchase`, `getPurchases`, `getPurchaseDetail` | `phase4-transaction-contracts.integration.test.ts`, `phase4-mixed-purchase.integration.test.ts` | Invalid/missing/duplicate lines, supplier, amount and saved inventory, purchase/read parity, FIFO source lot and due |
| `updatePurchase`, `deletePurchaseRoute` | `phase4-transaction-contracts.integration.test.ts`, `phase4-mixed-purchase.integration.test.ts` | Reason and returned/tracked/mixed/order locking, post-edit running ledger, multi-lot deletion quantity, compensating supplier ledger, historical paid invoice guard |
| `getPurchaseForReturn`, `completePurchaseReturnRoute`, `getPurchaseReturnHistory` | `phase4-transaction-contracts.integration.test.ts`, `phase4-mixed-return.integration.test.ts` | Original source lots, partial/over returns, duplicate product rows, cash refund hold, exact credit, forced rollback, records/audit |
| `getMixedPurchaseForReturn`, `completeMixedPurchaseReturn`, `prorateOriginalPurchaseMicro` | `phase4-mixed-return.integration.test.ts` | Frozen purchase unit-cost, partial return rounding, idempotency, stock/credit and source profile changes |
| `readUnitProfile`, unit quote and 2–4-level quantity chain | `phase4-mixed-purchase.integration.test.ts`, Playwright | Stale revision, unit factors and per-unit price, overflow, snapshot immutability, FIFO |
| `paySupplierRoute`, `createSupplierSettlement`, `listSupplierSettlements`, `reverseSupplierSettlement`, `getSupplierPaymentRoute`, `updateSupplierPaymentRoute`, `deleteSupplierPaymentRoute` | `phase4-supplier-settlements.integration.test.ts` | Cash/bank/mobile, open session, sufficient funds, idempotency/replay, simultaneous withdrawals and reversals, legacy API, blocked edit/delete, original-account reversal, audit |
| `analyzePurchasePlannerRoute`, `buildPlannerRows`, `savePurchasePlanRoute`, `updatePurchasePlanRoute`, `rejectPurchasePlanRoute`, `deletePurchasePlanRoute`, `listPurchasePlansRoute`, `getPurchasePlanRoute` | `phase4-plan-order.integration.test.ts`, `phase4-transaction-contracts.integration.test.ts` | Low-stock proposal, draft edit/approval/rejection/deletion, inactive supplier, no inventory write before purchase, rollback, audit |
| `approvePurchasePlanRoute`, `listPurchasePlanOrdersRoute`, `getPurchasePlanOrderRoute`, `getPurchasePlanOrderConvertDataRoute` | Same planner suites and Playwright | Supplier-wise approved order, exact quantities, single conversion, partially/fully converted plan, supplier due and FIFO, concurrent/retry safety |

Private formatting and SQL helpers are exercised transitively through their public functions. The **native Node coverage report** measures their actual function and line execution; this matrix is not a claim of 100% coverage. Inspect the report for uncovered branches before release.

## Executable test commands

```bash
npm run backend:build
node --import tsx --test tests/phase4-*.integration.test.ts
node --import tsx --experimental-test-coverage --test-coverage-include='server/modules/purchases/**' --test tests/phase4-*.integration.test.ts
node ui-checks/run.mjs
node d1-checks/run.mjs
node d1-checks/phase12.mjs
node d1-checks/phase13-browser.mjs
```

The CI workflow runs these on isolated test databases, Playwright 390/768/1440 viewports and the disposable local Wrangler Worker. Coverage text is retained at `d1-checks/output/phase4-function-coverage.txt` in the `hisabiq-worker-d1-local-checks` artifact.

## Non-negotiable transaction invariants

1. No purchase, plan approval or payment may write only a subset of its supplier, FIFO, audit, money and order records. Failed inserts must roll back the whole D1 batch.
2. Sum of active supplier ledger debits minus credits must reconcile to the supplier master due; the latest stored running balance must also match.
3. Multiple purchase source lots for the same product must reduce stock cumulatively on deletion. Returning a quantity must not exceed the original unsold source-lot quantity.
4. An approved supplier order can generate **exactly one** matching purchase with the approved supplier and product/base-unit quantities.
5. Cash/bank/mobile settlement requires an actual money-book entry and active-account checks. Replay and concurrent requests must never produce duplicate money movements.
6. No posted payment may be silently edited/deleted: use the audited reversal endpoint.
7. Historical paid invoices cannot be deleted without a financial reversal; legacy purchase-time payment and Cash purchase-return paths are held until transactional cash/bank implementation.

## Release status

Draft tests and fail-closed changes are not permission to migrate hosted D1. Require **exact-head green backend, coverage, React build, Playwright/axe and local Worker/D1 CI**, then independent accounting review and explicit promotion approval. No test runner writes to production or hosted D1.
