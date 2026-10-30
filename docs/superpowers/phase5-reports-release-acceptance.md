# Phase 5G — Reports release acceptance (GitHub-only)

**Status:** Draft PR #22; not approved for merge or production deployment. Business Audit (5F) is deferred for redesign. These checks cover only implemented live reports.

## Boundaries
- Preserve the pinned `apps/hisabiq-web` React submodule, original compact HisabIQ design and exactly two main Reports tabs: **Dashboard** and **Report Library**.
- Backend reporting stays behind normal authentication and `reports.view`. Read routes are strictly GET, with no D1 writes or privileged access fallback.
- No sample figures in real D1. Missing FIFO source evidence, unreconciled bank accounts or unmatched expenses must remain `incomplete` with nullable totals, never estimated as zero.
- Historical stock/dues snapshots, invoice aging and auditing remain unavailable. Bank balances are **current**, never misrepresented as a prior-period balance.
- Phase 3/4 interfaces must not be assumed finalized from draft/unmerged branches.

## Automated gate (each new exact head SHA)
1. `node --test react-integration/tests/reports-source-parity.test.mjs` — verifies the real D1 parity checks remain wired into the CI workflow, RBAC routing remains upstream, and Business Audit has no unexpected renderer.
2. `node --import tsx --test tests/reports-*.integration.test.ts` — source reconciliation for posted sales, original FIFO cost/returns, stock, customer/supplier dues, cash, banks, transfers, expenses, finance; malformed query checks and SQLite no-write invariant.
3. `node d1-checks/run.mjs` — **isolated local Wrangler D1**, with synthetic sales and real persisted source rows; reject unauthenticated and restricted reporting, verify per-row source ID and amount, reject malformed data, check financial table state unchanged after GETs.
4. `node ui-checks/run.mjs` — mocked-API Chromium 390/768/1440 responsive report pages, money-in/out display, focusability/axe accessibility, no report writes; screenshots saved as CI artifacts.
5. `npm run backend:build`, `npm run react:build`; pinned submodule must remain clean. CI must show all required jobs green on the same head SHA, not a predecessor.

## Release decision
- A passing **local** pipeline is necessary but insufficient to merge: review open Phase 3/4 reconciliation dependencies, independently check money formulas and RBAC, and verify Report Library click-through/source parity.
- `deploy-hosted-preview` and `accept-hosted-preview` are intentionally skipped by default and **not passed**. Any hosted preview requires separate explicit authorization. Production deployment/migration and PR merge remain out of scope.
- Re-run the same checks on the merge candidate. Keep audit `/api/reports/v2/audit` unavailable until the redesigned specification is separately approved.

**CI reference:** https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41016300362 — record its final conclusion and exact SHA before marking Phase 5G complete.
