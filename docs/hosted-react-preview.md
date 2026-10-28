# Cloudflare-hosted HisabIQ React preview — controlled deployment

Status: **prepared in draft PR #9; NOT deployed**. This workflow does not
touch the existing Vue Worker \`shererp-new\` or the existing production D1.
The following instructions require authorized Cloudflare/GitHub account access.

## Fixed isolation contract

| Resource | Preview-only value |
|---|---|
| Worker name | \`banijjiq-hisabiq-react-preview\` |
| D1 name | \`banijjiq-hisabiq-react-preview-db\` |
| Binding | \`DB\` mapped to the new preview D1 UUID |
| Frontend | Pinned HisabIQ React build artifact from PR #9 |
| API | Existing BanijjIQ Hono Worker entrypoint |
| Custom routes | None; uses only \`*.workers.dev\` |
| Authentication | Separate preview-only admin and setup secret |
| Database data | Fresh, empty business data; never copy production |

**Do not use a production D1 UUID** (including as a “temporary” preview
binding). The config generator rejects the production UUID in \`wrangler.jsonc\`.
Remote preflight also checks that the actual D1 database name and UUID both
match the dedicated preview resource. Preview configuration is generated into
a gitignored file at the repository root. Never modify the production
\`wrangler.jsonc\`.

## First-time account setup (requires an authorized operator)

1. In the intended Cloudflare account, create a **new** D1 database named
   \`banijjiq-hisabiq-react-preview-db\`. Via a locally authenticated Wrangler:
   \`npx wrangler d1 create banijjiq-hisabiq-react-preview-db --location apac\`
   (or create it in the Cloudflare dashboard). Keep the new database UUID.
2. Create a Cloudflare API token scoped to that account with Workers Scripts
   deployment permission and D1 database read/write capability. Do not use a
   global API key. Prefer the least privilege allowed by Cloudflare.
3. In GitHub **Settings → Environments**, create
   \`hisabiq-react-preview\`, configure reviewer approval and deployment
   restrictions where available. Add the following as **environment secrets**
   (not committed files and not workflow inputs):
   - \`CLOUDFLARE_ACCOUNT_ID\` — account ID, **not** database ID
   - \`CLOUDFLARE_API_TOKEN\` — Cloudflare API token
   - \`HISABIQ_PREVIEW_D1_ID\` — UUID of the newly created preview database
   - \`HISABIQ_PREVIEW_SETUP_SECRET\` — unique random secret (at least 24 chars)
   - \`HISABIQ_PREVIEW_ADMIN_PHONE\` — separate preview login phone
   - \`HISABIQ_PREVIEW_ADMIN_PASSWORD\` — new preview-only password (at least 12 chars)
4. Ensure the Cloudflare account's \`workers.dev\` subdomain is enabled.
   GitHub's hosted preview smoke check retrieves that subdomain from Cloudflare.

GitHub permissions to run a workflow and access environment secrets are
controlled by the repository and environment settings. No such secrets were
read, modified or assumed in the preparation of PR #9.

## Execution

The registered default-branch launcher executes tests before reaching
its environment-protected deployment step. It runs only with all of these:

- manual `workflow_dispatch` of the default-branch launcher on `main`
- `reviewed_commit_sha` equal to the exact current head SHA of draft PR #9
- `confirm_isolated_preview = ISOLATED-PREVIEW-ONLY`
- successful React build, full SQLite/Worker-local D1 accounting checks,
  and Chromium UI tests in the same run
- valid environment secrets and any configured environment reviewer approval

**Default-branch manual launcher is registered:** `.github/workflows/hisabiq-hosted-preview-dispatch.yml`
was committed to `main` at `2607bc729c121d288e3a32996cf68da94be1269d`,
without merging PR #9 or deploying the ERP. In GitHub **Actions →
Authorize isolated HisabIQ React preview → Run workflow**, select `main`,
enter the current reviewed full **40-character PR #9 head SHA** as
`reviewed_commit_sha`, and enter `ISOLATED-PREVIEW-ONLY` as
`confirm_isolated_preview`.

The launcher checks that PR #9 remains open in this repository on the exact
reviewed commit. It reruns SQL, browser and local Worker/D1 checks before
entering the `hisabiq-react-preview` GitHub environment. Configure its
six secrets and required reviewer approval **before** dispatching. The
workflow has no push or pull-request triggers. No hosted deployment has
been performed.

Once dispatch is authorized, the job creates an isolated Wrangler config,
checks the **remote** D1 UUID and name through Cloudflare's metadata API,
applies migrations remotely **only to that D1**, deploys the distinct preview
Worker, sets the preview setup secret, and runs HTTPS smoke checks.

The smoke checks verify health, reject unauthenticated requests, initialize
the preview administrator **only on first run**, log in using preview-only
credentials, read Products and POS bootstrap, and fetch the React HTML.
They deliberately **do not post sales, adjust stocks or open cash sessions**.
They do not print secrets, authentication tokens or phone numbers.

The resulting \`*.workers.dev\` URL appears only after Cloudflare provides its
real subdomain; do not guess a URL from the production hostname. The GitHub
workflow's step summary and \`hisabiq-hosted-preview-smoke\` artifact report
the verified URL and test results.

## Reviewing and rolling back

- Review screenshots and accessibility reports from the \`react-build\` job.
- Confirm login, Products, POS keyboard focus, checkout and receipt manually
  on phone, tablet and desktop. Use synthetic test inventory only.
- Before cutover, separately test real remote D1 sales/returns, FIFO
  reconciliation, authorization and concurrent writes. Browser smoke is not a
  financial release gate.
- Rollback of the hosted preview: pause its workflow, disable its Worker,
  and disable preview credentials. **Never** delete or revert the production
  Worker/D1. Cloudflare D1 time travel/backup should be reviewed separately
  before destructive preview maintenance.
- Production migration needs an explicit subsequent approval and separate PR.

## Related tests

\`node scripts/preview/build-config.mjs --self-test\` and
\`node --test tests/preview-deploy.contract.test.mjs\` run in ordinary PR CI
without Cloudflare credentials. The existing \`d1-checks/run.mjs\` tests the
real Worker against **local** D1. Only the guarded hosted-preview job uses
remote D1 commands.
