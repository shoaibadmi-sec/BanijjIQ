# Phase 7B — FIFO Valuation Safety Design (30 October 2026)

## Goal
Reconcile today's remaining FIFO stock at original acquisition cost without publishing an incorrect amount as inventory asset value. Do not treat a stock snapshot as historical as-of valuation.

## Existing behavior
`server/modules/reporting/live/stock-dues.ts` computes the Report Library stock inventory metric and rows directly from `products` and `stock_lots`. It already withholds inventoryValue for negative stocks, most malformed costs, master/lot disagreements, orphan lots and incomplete collection bounds. It uses floating-point near-comparison, and checks each lot/product's safe minor-unit amount but does not enforce valid 4-decimal source precision, possible remaining quantities or the safe grand-total limit.

## Implementation decision
Strengthen the existing read-only report, not a parallel valuation table/service. Existing GET /api/reports/v2/rows?report=stock and GET /api/reports/v2/summary stay unchanged. Keep same UI and source evidence IDs.

## Business invariants
- Stock quantity and unit cost must be finite, nonnegative and within four decimal places; reject any input with five or more significant decimal places.
- Positive remaining FIFO lot quantity must not exceed its source's original quantity; if source quantity is missing or corrupt, do not invent it.
- Master quantity equals the sum of surviving FIFO lot quantities, compared at exact four-decimal integer ticks, not a floating epsilon.
- Value is sum of original remaining lot acquisition costs, NOT product selling price; use existing report's per-lot two-decimal display money rounding.
- Every product amount and whole-business stock total must be a safe integer of poisha (cents), with overflow marked incomplete and value null. Do not publish a rounded unsafe total.
- Any invalid lot must block that product's amount and the whole-business inventoryValue. Unaffected product rows can still show their own amount, marked needs-review rather than an invented historical value.
- Preserve current snapshot warning, bounds (5,000 products and 10,000 lots), orphan handling, privacy and non-mutating reads.
- No new migration, dependency, stock write, production D1 activity, UI redesign, automatic merge or release.

## Alternatives
1. New valuation engine in Phase 7A: rejected because the Report Library already owns FIFO stock valuation and duplicating it would drift.
2. Recompute historical stock asset by sale-date: rejected because the current schema lacks proven as-of source reconciliation.
3. Chosen: fail-closed precision and money-safety guards in existing report with explicit accounting tests.

## Tests
Separate `tests/phase7b-fifo-valuation.business.test.ts` exercising 5dp quantity and cost, master/lot mismatch, lot remainder greater than original, safe aggregate overflow, legitimate two-lot original-cost valuation and no-write behavior.
Use Node test runner + tsx already installed. CI npm run test:phase7b plus existing report and full React/Worker tests.
