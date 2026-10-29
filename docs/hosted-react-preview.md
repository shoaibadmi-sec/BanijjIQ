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
2. For the narrowest Cloudflare token permissions, **create a blank Worker**
   named `banijjiq-hisabiq-react-preview` in the Cloudflare dashboard first
   (separate from `shererp-new`). Enable its `workers.dev` endpoint. Then
   create a Cloudflare **API token**, not a Global API Key, with **Workers Editor**
   on this individual preview Worker and **D1 Edit/Write** for the dedicated
   preview database (plus any account-level D1 metadata/read and Workers
   subdomain read permissions required by the preview preflight and smoke
   endpoints). Prefer database-level scoping if your account offers it.
   If you do not precreate the Worker, initial creation requires **Workers
   product-level Admin** rather than per-Worker Editor. Never grant a
   production Worker deployment permission merely to simplify preview setup.
   Official permission references:
   https://developers.cloudflare.com/workers/authorization/workers/
   and https://developers.cloudflare.com/fundamentals/api/reference/permissions/.
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
was **synchronized on `main` at `e8eb0b18b521fd96e59c011b82d362f8e0039c6d`**,
without merging PR #9 or deploying the ERP. GitHub verified the commit
changes only the manual launcher and its contents exactly match the
PR branch's protected Phase 12/13/14 workflow. In GitHub **Actions →
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

## Phase 14 security review — launcher synchronized, credentials unverified

Both the draft PR #9 workflow and the registered manual launcher on `main`
now run baseline, Phase 12 and Phase 13 real Worker/D1 checks **before**
any protected deploy. The independent `accept-hosted-preview` job requires
a successful isolated deploy, uses a separate protected environment gate,
and performs read-only Chromium authentication, POS, Products, Sales Returns,
responsive/keyboard and accessibility acceptance.

**Verified:** the manual-only launcher on `main` is the same blob as the
reviewed PR workflow. **Not verified:** whether Cloudflare's preview D1
exists, the API token has required roles, or the GitHub environment has all
six secrets and reviewer/deployment protections. Those settings are not
readable through the available connected GitHub tools; the operator must
check them in the Cloudflare and GitHub dashboards. Never dispatch until
they are configured.

The additional `scripts/preview/browser-acceptance.mjs` acceptance suite
is read-only and enforces the exact dedicated `workers.dev` hostname. It
uses actual Chromium, actual isolated API reads and actual preview-only
login at 390/768/1440px, checking Products, POS, Returns, F2 keyboard,
document overflow, screenshots and axe-core accessibility findings.
An API request allowlist permits only GET and POST `/api/auth/login`;
other writes abort before transmission and fail the audit. The remote
suite runs **only after** an approved isolated preview deployment and
cannot be initiated from a normal PR CI event.

The same acceptance function runs locally as part of
`d1-checks/phase13-browser.mjs` using an exclusively disposable D1.
A local success does not establish hosted Cloudflare permissions or
remote D1 readiness. Refer to `docs/hisabiq-react-phase14.md` before
any preview authorization. Production remains untouched.

## Exact minimal operator steps

1. Cloudflare dashboard: create dedicated D1 database `banijjiq-hisabiq-react-preview-db`; record its **UUID**, not its name. Create the dedicated Worker `banijjiq-hisabiq-react-preview` and enable its workers.dev endpoint. Create a narrow Cloudflare API token as above.
2. GitHub repository **Settings → Environments → hisabiq-react-preview**: add a required reviewer if available, set **deployment branches = selected branches → main**, then store the **six environment secrets** listed above. Do not add secrets to repository source or chat.
3. Open https://github.com/shoaibadmi-sec/BanijjIQ/actions/workflows/hisabiq-hosted-preview-dispatch.yml and **Run workflow** on `main`. Copy the **current** full 40-character PR #9 head SHA from GitHub into `reviewed_commit_sha`, and enter `ISOLATED-PREVIEW-ONLY` as confirmation. Approve the environment protection request only after reviewing the verified commit.
4. After jobs `verify-reviewed-commit`, `deploy-isolated-preview` and `accept-hosted-preview` succeed, open the actual preview URL shown in the **HTTPS smoke** job summary/artifact. Login using the preview-only phone/password secret values. Use only test data. The smoke/acceptance jobs never create sales or returns remotely.

If a job fails, inspect GitHub Actions logs; never substitute the production D1 UUID or reuse production passwords to bypass preflight. This launches a **separate** React preview; the existing Vue Worker remains the live ERP. No PR merge or production cutover is included.
