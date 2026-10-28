# HisabIQ_UI React frontend + existing BanijjIQ API

## Decision
The approved production UI source is **HisabIQ_UI React**, NOT a Vue component-by-component port. Keep BanijjIQ's Hono backend, Cloudflare Worker runtime, D1 data and migrations unchanged. The existing Vue application remains the production fallback until feature parity is verified.

## Pinned source
Original source: https://github.com/shuvodelux-commits/hisabiq_ui
Pinned commit: `9a8dc1ac4e85ac4e60f254e068bd67c2a805673f`
Git submodule: `apps/hisabiq-web`
Do not blindly track source main: review and update the pinned SHA, then run the integration build and tests.

## How to build
```bash
git clone --recurse-submodules https://github.com/shoaibadmi-sec/BanijjIQ.git
cd BanijjIQ
git checkout feat/hisabiq-react-api
npm run react:build
```
The build makes a disposable, ignored copy in `.generated/hisabiq-web`; the React app compiles to `.generated/hisabiq-web/dist`. GitHub Actions automatically builds it on this PR and uploads compiled assets. `npm run build` and the existing live Cloudflare config still build/deploy the **old Vue frontend**, deliberately.

## Integration overlay
`scripts/prepare-hisabiq-react.mjs` copies the pinned source into `.generated/hisabiq-web` and applies `react-integration/overlay` **only to that disposable build worktree**. The Git submodule stays clean, pinned, and directly reusable.
- Login, account verification and logout use existing `/api/auth/*` endpoints with the same bearer-token key as the existing Vue app.
- `#/app/live-products` is the first **real API-backed** read-only HisabIQ-style screen, using `/api/bootstrap` product records.
- All other inherited HisabIQ_UI screens still use fixture / demo stores and MUST NOT be mistaken for real sales, inventory, ledger or cash posting. A visible banner says so.
- The demo sign-in/signup preview routes remain examples inside the design app; **only the outer backend gate signs in to BanijjIQ**. Do not equate preview UI with working auth flows.
- The source's HashRouter is retained; only API requests go to Hono.

## Deployment safety
`wrangler.react-preview.example.jsonc` is intentionally NOT deployable without a **separate preview D1** database. Never bind a preview with sample workflows to the production D1 database. Production Wrangler remains unchanged and continues serving Vue.
No stock, money, invoices, or permissions are mutated by the new read-only Products integration. Backend authorization still applies to /api/*.

## Remaining migration gates
1. Add API adapters and production workflow wiring to each module without changing the approved component design: Dashboard, Products create/edit, POS, Sales/Returns, Purchases, Parties, Vendors, Finance, Bank, Daybook, Reports, Settings.
2. For unsupported preview-only features (multi-unit, installments, drafts, SMS, bundle posting, etc), implement and verify backend contracts or explicitly disable those workflows.
3. Build dedicated preview database and deploy isolated Worker; test login, permission guards, POS totals and real posting, FIFO, refunds, customer due, printing, mobile and dark-mode.
4. Compare route parity and get business acceptance before replacing existing live Vue assets. Do not delete the Vue frontend or merge the previous Vue redesign PRs until a tested cutover strategy is approved.

## Phase 2 — 2026-10-28
- Main `#/app/products` route now uses the real product read-only catalog with the approved HisabIQ shared Table/PageHeader styling. Demo product editor is not connected to production and is reachable only at `#/app/products-design-preview` for design comparison.
- Main `#/app/pos` route now uses a real API-backed **single-unit** POS utilizing HisabIQ's original ProductCombobox and PageHeader, and BanijjIQ's POS bootstrap + /api/pos/sales transaction endpoint. Original demo POS is still visible at `#/app/pos-design-preview` for comparison and is clearly labeled as demo by the gate.
- Cash session opening is an explicit user action. Real sale posting requires customer name/phone, existing active session, no stock shortage, no tracked serial/expiry, valid integer quantities, valid discounts and payment account where needed. Confirmation modal is mandatory; post only once pending; successful response shows the server invoice ID.
- Not yet supported in the integrated POS: mixed units, negative/vendor fulfillment, tracked products, bundles, installment, split payments, invoice editing/printing, draft/templates. Such features remain unoffered, not silently approximated.
- Both new routes use backend permission declarations; Hono continues enforcing permissions server-side.

### Post-result ambiguity safeguards
- If POST /api/pos/sales fails due to network transport or server 5xx, the UI treats the transaction result as **unknown**, not safely failed. It blocks retry, shows recent invoices for the entered phone through /api/pos/sales-by-phone, and requires explicit reconciliation before allowing another post.
- A synchronous submission lock prevents rapid duplicate clicks. This is a client-side guard only; backend idempotency keys remain a recommended production enhancement before switching away from Vue.
