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
The React app compiles to `apps/hisabiq-web/dist`. GitHub Actions automatically builds it on this PR and uploads compiled assets. `npm run build` and the existing live Cloudflare config still build/deploy the **old Vue frontend**, deliberately.

## Integration overlay
`scripts/prepare-hisabiq-react.mjs` overlays `react-integration/overlay` onto the checked-out source **at build time**. The source submodule remains pinned and directly reusable.
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
