# Phase 7F2 — Live stock alerts in pinned HisabIQ Products UX

## Dependency and isolation
This is a **stacked draft** on Phase 7F1 (`feat/hisabiq-phase7f-stock-alerts-tdd`), not independently mergeable into main. Existing pinned HisabIQ React source and original Products JSX remain unchanged; only its generated integration copy receives the new alert strip through the exact-blob source-safe patch.

## UX contract
- Keep original four summary cards, Product table, underline tabs, column picker, row actions, blue/teal tokens and mobile/tablet layout.
- Add one compact stock-alert strip between existing summary and table. Show live expiry and source-integrity counts from `GET /api/products/stock-alerts`, never demo numbers.
- Clicking **Review** reveals a compact, source-labelled alert list with pagination. Clicking a product filters the real Products table by its name and resets category and stock filters.
- Show a bilingual label. Never claim all stock is healthy when the API fails, times out or returns incomplete source coverage. Disable Review on errors or when no alerts are present. Give users a manual Refresh.
- Recheck alerts when live products refresh. No automatic writes, purchase orders, alerts scheduling or background polling.
- Use Products.view permissions and existing token/session handling in `banijjApi.request`; no new authentication pathway.
- Compute date-only `asOf` from the current business user's browser local calendar rather than UTC crossing midnight.

## Test-first evidence
- Initial source-UX RED: `react-integration/tests/phase7f2-alerts-source.test.mjs` failed because exact patched Products markup lacked `LiveStockAlerts`.
- Initial typed-client RED: `react-integration/tests/phase7f2-alerts-client.test.ts` failed because `getStockAlerts` was absent.
- Focused tests pass after code. React build and Playwright/axe must run on exact PR head in GitHub Actions before merge.
- Visual/keyboard assertions for 390px mobile and 768/1024/1440px layouts use the existing UI workflow's isolated mock API. No hosted preview or production deployment is authorized.

## Release hold
Do not merge Phase 7F2 before Phase 7F1 is reviewed/merged and required CI green on the final rebased 7F2 SHA; do not modify hosted Cloudflare or remote D1.

## Superseded frontend UI scope — mandatory original UI only

A later explicit product rule prohibits new UI. Do not render a stock-alert strip, panel, button, or custom layout. The typed, authorized GET client remains a backend integration contract, for future use only with an **existing original HisabIQ_UI control** and explicit source-parity tests. The source-backed product list, existing stock cards, filters, tabs, and original styling stay unchanged.
