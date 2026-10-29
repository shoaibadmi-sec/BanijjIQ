# HisabIQ React migration — Phase 14: isolated hosted-preview readiness and browser acceptance

**Branch:** `feat/hisabiq-react-api` · **Draft PR:** #9 · **Production:** unchanged.

## Scope

Phase 13 verified real React → Hono Worker → disposable Wrangler D1 with actual
Chromium postings and exact accounting. Phase 14 prepares a separate
**read-only hosted-preview browser acceptance gate**, and rehearses that exact
runner against the local Phase 13 Worker/D1 before authorizing any remote step.
It does **not** authorize deployment, create Cloudflare resources, change DNS,
use existing production D1, merge PR #9, or change the pinned HisabIQ source.

## New isolation and review safeguards

- `scripts/preview/browser-acceptance.mjs` accepts only
  `https://banijjiq-hisabiq-react-preview.<verified-subdomain>.workers.dev`
  for remote testing. The sole local rehearsal exception is the exact
  `http://127.0.0.1:8793` Worker with `allowLocal:true` supplied in code;
  CLI remote execution does not offer a URL override.
- Cloudflare account subdomain comes from the account-scoped API, not guessed
  from the existing Vue production hostname.
- Playwright permits actual `GET /api/*` reads and **only**
  `POST /api/auth/login`. Every other API write is blocked *before network
  transmission*, recorded as a test failure. No route mocking is used.
- Tests open signed-out POS and assert the authentication gate, then sign in
  using a **separate preview administrator** and open actual React POS,
  Products and Sales Returns. F2 keyboard focus, layout widths, browser
  errors, screenshots and axe WCAG 2 A/AA + 2.1 A/AA reports are checked at
  390, 768 and 1440 pixels.
- The browser suite has no cash session opening, sales, returns, vendor
  creation, product writes, user administration or remote SQL access.
  Critical WCAG violations, any top-level horizontal overflow, unexpected
  HTTP 5xx, or attempted write cause failure; noncritical axe findings are
  saved for review and do not imply full WCAG certification.
- Screenshots are limited to synthetic/empty preview business records. No
  credential values or auth tokens are copied to test artifacts.

## GitHub Actions changes on PR #9

1. The ordinary PR CI runs the same read-only browser acceptance function
   against real temporary local Worker/D1 in `d1-checks/phase13-browser.mjs`.
   Expected: **15 read-only tests** (five at each viewport), six axe audits
   and nine screenshots, in addition to the existing serial/expiry,
   vendor/negative and sales-return E2E and SQL reconciliation.
2. The manual preview workflows on this PR branch add an
   `accept-hosted-preview` job. It needs the preceding environment-protected
   `deploy-hosted-preview` / `deploy-isolated-preview` job to succeed,
   and it separately uses the protected `hisabiq-react-preview` environment.
   It checks out the reviewed commit and pinned React source, installs
   Chromium from the source project's dependency manifest, then runs
   `node scripts/preview/browser-acceptance.mjs --remote`.
3. The PR-branch copy of the default-branch manual launcher is also updated
   to rerun baseline, Phase 12 and Phase 13 accounting/browser suites
   **before** its environment-protected deployment stage.
4. `tests/preview-deploy.contract.test.mjs` asserts the hostname restriction,
   read-only request policy and guarded workflow dependency.

### Default-branch registration blocker

The manual `workflow_dispatch` launcher that GitHub currently offers on
`main` is an **older independent copy**. Updating the file in draft PR #9
does **not** update GitHub's default-branch launcher. Until that manually
maintained launcher is separately reviewed and synchronized, **do not
authorize or dispatch hosted deployment using the older default-branch
workflow**. This PR deliberately does not merge itself into `main` or alter
production to work around that gate.

## Acceptance/release hold

A successful **local rehearsal** proves that the code path works against a
real local Worker/D1. It does *not* prove access to Cloudflare credentials,
a remote D1 database, reviewer approval or a live hosted preview URL.
Hosted acceptance requires the six preview-only GitHub environment secrets,
dedicated Cloudflare D1 UUID and name metadata preflight, exact reviewed PR
SHA, approved operator dispatch and configured environment protection.
No such deployment has been requested or executed in Phase 14.

Even after a future successful hosted read-only browser run, production release
still requires separate verified financial transactions against dedicated
hosted preview D1, authorization/race tests, printing, and feature parity for
mixed-unit stock, bundles, drafts, Store Credit and full Sales flows.

**Never merge PR #9 or deploy to production without a separate approval.**
