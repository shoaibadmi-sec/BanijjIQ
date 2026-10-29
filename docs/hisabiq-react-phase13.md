# HisabIQ React migration — Phase 13: tracked POS, shortage sourcing, cash returns

**Branch:** `feat/hisabiq-react-api` · **PR:** #9 (draft, not merge-ready)

## Design and source boundaries

- Original pinned `apps/hisabiq-web` React submodule stays unmodified. All integration edits are under `react-integration/overlay` and the build-copy route injection.
- Use original `ProductCombobox`, `SerialPickerDialog`, `ReceiptPreview`, `PageHeader`, `Button`, `Input` and `Dialog` components, and match the source StockShortage dialog visual/choice patterns.
- Do NOT call `partyPreviewStore` for live vendors: `LiveStockShortageDialog.tsx` reads `GET /api/pos/bootstrap` vendors and quick-adds through `POST /api/pos/vendors`.
- The original demo Sales page and POS-design-preview remain available but cannot silently post real accounting.

## Live POS adapters

- `GET /api/pos/products/:id/tracking-options` provides eligible serials (expiry-filtered). Select exactly the requested count using the original serial picker. Expiry-only stock uses the backend FEFO planner automatically.
- Tracked products cannot use negative/vendor sourcing and cannot exceed sellable tracked stock.
- Untracked shortages require an explicit choice: clamp to own stock; negative sale; or a real vendor ID and nonnegative agreed unit cost. Changing quantity resets the choice.
- The preexisting stable sale idempotency key, customer/phone, cash session, review confirmation, Bank/Mobile payment account and unknown-result lookup protection remain active.

## Live Sales Return adapter

- Dedicated new route `#/app/live-sales-returns`, linked from live POS, without replacing source Sales UI.
- `GET /api/sales-returns/search`, `GET /api/sales-returns/:invoiceId/data`, `POST /api/sales-returns`, `GET /api/sales-returns` history are used for live invoices and returns.
- Return only eligible own-stock line quantities, with the selected original invoice serials when tracked. Vendor-sourced units are excluded by the backend.
- This stage enables *cash refunds* only, not Store Credit. Cash refund amount must be positive, no larger than the still-unreturned invoice value or funds paid; return-price adjustment above historical price is blocked.
- Unknown response (network/5xx) freezes further posting until Return History is fetched and the user verifies the ledger. There is no blind retry because return requests have no idempotency token.

## Verification and release hold

- GitHub `hisabiq-react-build.yml` runs source-pinned React type/build checks, contract checks, mocked Chromium interactions (serial, own/negative/vendor choice, cash return), and the isolated Phase 12 live Worker/D1 accounting suite.
- Do not mistake mocked UI requests for actual remote D1 verification. The backend's Phase 12 suite independently covers actual serial/expiry, vendor/negative posting, return/cancellation races and exact SQL reconciliation.
- Still unverified: hosted preview D1; advanced Store Credit ledger under concurrency; POS multi-unit/bundles, batch returns and drafts; real printer acceptance; complete Sales UI route replacement; visual reviewer signoff.
- Never merge PR #9 or promote Cloudflare production without explicit approval, separate preview D1/credentials, final migration compatibility review and rollback plan.
