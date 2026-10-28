# Cloudflare Worker + local D1 accounting checks

This CI suite exercises the **real Hono Cloudflare Worker runtime** and D1 through
Wrangler's local development mode. It is separate from the existing in-memory
SQLite API regression and the Playwright mocked-API UI tests.

## How it runs

1. Build the pinned React frontend into `.generated/hisabiq-web/dist`.
2. Read `wrangler.d1-ci.jsonc` (dedicated fixture Worker name and synthetic
   D1 database UUID), then verify that neither matches the production config.
3. Apply **all real migrations** using `wrangler d1 migrations apply DB --local`
   with a fresh, temporary `--persist-to` directory.
4. Start `wrangler dev --local` against that directory, using an ephemeral
   *test-only* setup secret.
5. Exercise HTTP authorization and setup-secret enforcement, product creation,
   opening stock, cash session, full and partial sales, invoice readback, payment,
   due account, idempotency replay/mismatch, concurrent duplicate delivery,
   and oversell rejection.
6. Stop the Worker, query **D1 SQL** using the same local persistence directory
   to reconcile invoices, product stock, lot draws, cash book, customer ledger
   and unique request keys.
7. Remove the temporary local database and upload only redacted results/logs.

## Run locally

```bash
npm ci
npm run react:build
node d1-checks/run.mjs
```

The script uses no Cloudflare API token and never passes `--remote`.
It is designed to fail if its D1 database UUID matches the production config.

## Inspect GitHub results

GitHub Actions -> `HisabIQ React / BanijjIQ API integration` ->
`hisabiq-worker-d1-local-checks` artifact: `d1-local-results.json`, `worker.log`.
The checks are a required CI step on PR #9.

## Deliberate limits

This is the **local Cloudflare Worker + local D1 implementation**, not a
deployed Worker on Cloudflare's global infrastructure. It verifies local D1
behavior with the production backend source, but still cannot prove deployed
D1 consistency under concurrent multi-region requests. Before production
cutover, provision a separate remote preview D1, use separate preview secrets,
deploy the React Worker there, test permissions/accounting/returns against that
dedicated preview, review screenshots, and plan rollback. Production D1 must
never be copied into the test environment without an explicit privacy and data
handling review.

## Real React browser on real local D1

The test runner also launches Chromium against the **same local Wrangler Worker**
while it is still running. This is separate from the mocked API screenshots in
`ui-checks/`. The browser must show the sign-in gate, submit real preview-only
admin credentials, display the actual D1 Products row, use keyboard F2 and the
original POS product combobox, post exactly one real POS invoice, and fetch the
**saved** invoice receipt from D1. It captures mobile (390px) and desktop
(1440px) screenshots named `d1-real-*.png` in the same GitHub artifact.

The final database reconciliation now asserts four invoices (three direct HTTP
fixtures plus one from Chromium), exactly one browser sale, stock 3, four unique
request keys, a matching browser cash-book entry, and the existing customer due.
The database is disposable, and no hosted or production Worker is contacted.
