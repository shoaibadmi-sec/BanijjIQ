# Phase 7E3B2B2A — Finalize fully returned cash bundle invoices as Reversed

**Dependency stack:** draft PR #105 -> #101 -> #97 -> #95 -> #87 -> main. Strict TDD and Ponytail. No merge/deploy until full exact-head CI, independent accounting review, and parent integration approvals.

## Safety-first scope
Add `POST /api/sales-management/bundle-invoices/:invoiceId/finalize-reversal`, requiring `sales.edit`, with JSON `{clientRequestId,reason}`. This is a **zero-money, zero-inventory** finalization of an original all-cash bundle invoice *already fully refunded* through authorized original-cost cash returns. It never performs a second refund or creates phantom stock. It does NOT reverse unreturned invoices automatically. Original sale lines, immutable component source allocation, receipts and return journals remain unchanged.

New additive migration `0063_bundle_invoice_reversal_finalization.sql` adds `bundle_invoice_finalizations`, one immutable request and action per invoice with unique request ID and reason. A guarded trigger must reject finalization unless:
- original invoice status Completed, not deleted, paid Cash, due/discount zero and one cash receipt equal original paid total;
- every visible sale_item is exactly matched by SUM sales_return_items for that invoice/product, no overreturn;
- all original physical `bundle_sale_allocations` are restored across `bundle_return_allocations` and `bundle_partial_return_allocations` for their original source IDs, no overrestoration;
- every `sales_returns` header is matched by one valid immutable full/partial/ordinary request marker, each header amount matches exact recorded cash-book debit and total refunds = original invoice paid amount;
- no previous canonical sale_reversal_logs or finalization; replay same request is read-only and conflicting IDs return 409.
- Existing legacy sale UPDATE trigger becomes *only* a narrowly allowed Completed->Reversed status transition with identical other sale columns, and a valid immutable finalization marker. Keep sale DELETE, sale_item UPDATE/DELETE, virtual stock triggers and unapproved reversal routes blocked. Update existing `trg_sale_reversed_status_requires_log` to recognize the new immutable finalization as an alternative to conventional `sale_reversal_logs`.
- Live Sales Profit report accepts the new certified finalization marker as reversal evidence and still demands actual cost/return provenance. No book entries during finalize; no live Worker D1 migrations.

Tests FIRST: full refund then finalize; partial bundle+ordinary refunds then finalize; double finalize replay no writes; missing/unreturned items and duplicate requests forbidden; direct legacy UPDATE, DELETE, /reverse still blocked; cash/stock unchanged; report status ready. Confirm CI RED 404 before GREEN; full backend+Phase4+React+Playwright+isolated Worker D1 exact head and third-party accounting review before production.
