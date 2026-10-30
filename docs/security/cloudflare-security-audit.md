# Cloudflare Security Audit Skill — BanijjIQ / HisabIQ

## What is installed

The upstream [Cloudflare security-audit-skill](https://github.com/cloudflare/security-audit-skill) is vendored in `.agents/skills/security-audit/`, pinned to commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` and accompanied by its MIT license and unmodified validation scripts.

This skill guides an AI coding agent through reconnaissance, coverage-led vulnerability hunting, independent validation, machine-readable findings, and verified reporting. **Installing the skill does not constitute a security audit or prove the ERP secure.** Ordinary security questions use guidance mode. A full audit must be requested explicitly and must respect the upstream sandbox/independent-verification requirements.

## Security boundaries that matter for this ERP

1. **Identity and RBAC:** `server/app.ts`, `server/core/handler.ts`, `server/modules/auth/`, `server/modules/admin/`; verify first-admin bootstrap secret, bearer sessions, password changes, disable/revocation, role changes, and permission mapping for every live route.
2. **Data and transaction integrity:** POS/sales, returns, purchases, supplier/customer ledgers, finance, stock FIFO, idempotency and all D1 transactions. Use only dummy tenant/principal fixtures with a disposable database, and verify no partial posting after an error.
3. **Data lifecycle:** backups/restores, audit logs, CSV/SQL exports, deletes, derived reports, archived/inactive records and future tenant separation; do not claim cross-tenant exposure if the deployment is not actually multi-tenant.
4. **HTTP/browser edge:** public authentication endpoints, CORS, error handling, input validation, React token handling, possible XSS and credential exposure. Consider Cloudflare Workers and the Node compatibility entry point separately.
5. **Deployment and supply chain:** `wrangler*.jsonc`, Cloudflare D1 binding names, preview isolation, GitHub Actions permissions, pinned dependencies and secret handling. **Never** run remote Wrangler migrations or deploy as part of an audit.

Relevant companion files: `ATTACK-CLASSES.md`, `WEB-PROTOCOL-AND-AUTH.md`, `DATA-ISOLATION-AND-LIFECYCLE.md`, `CLIENT-SIDE.md`, `CLOUD-AND-DEPLOYMENT.md`, `SUPPLY-CHAIN-AND-RELEASE.md`, and `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md`.

## How to use

Point the coding agent at this repository and direct it to `.agents/skills/security-audit/SKILL.md`. For a focused review, request: **"Use the Cloudflare security audit skill in guidance mode to review authentication, roles and error handling; report evidence and unresolved leads."**

For a complete engagement, explicitly request: **"Run the full six-phase Cloudflare security audit of BanijjIQ; write results outside the repository, use sandboxed disposable data and independent verification; never touch production."** The full audit requires a platform capable of isolated delegated agents, offline target execution and guarded artifact promotion; if unavailable, record `run_status: incomplete` and do not claim coverage.

The skill defaults to output outside the repository (`~/security-audit-skill/BanijjIQ/run-N`). A directory inside the repository is permitted **only** if the user explicitly selects it and it is wholly Git-ignored (e.g. `.security-audit/`). Do not commit `architecture.md`, `coverage-ledger.json`, `findings.json`, reports, attack fixtures, or private data without a separately agreed disclosure review.

## Development security gate

`npm run test:security` runs the vendored validator unit tests and the focused backend regression test for internal-error disclosure. GitHub Actions executes that command for every PR. The validators check the **audit format and tooling**, not ERP security or full coverage. Business/accounting tests, backend typecheck, React build, Playwright/axe, and isolated local Worker/D1 jobs remain mandatory.

In the test-first security PR, `handleApiRequest` had a source-visible path that returned raw exception text to the client. A focused test deliberately injected a synthetic database error and expected the generic 500 response. The pre-fix GitHub Actions run was RED: https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41069395334. The narrow remediation returns a stable non-sensitive message; this is **one targeted remediation**, not a verified six-phase audit.

## Review priorities after this PR

- Map all authenticated routes and compare their actual effects against RBAC permissions (including legacy and module-specific endpoints).
- Validate session revocation on password changes, role deactivation, account disablement, and logout.
- Trace all ledger write paths for atomic rollback and idempotency across D1 and the Node SQLite adapter.
- Audit backup/restore authorization, transaction boundaries, consistency and secret-bearing data handling.
- Review supply-chain/CI and Worker preview/production separation.

A finding is **confirmed** only with a complete source trace, bounded observed effect, and independent verifier. Otherwise record the exact validation blocker without assigning severity.
