# HisabIQ / BanijjIQ — Mandatory Engineering Rules

These rules apply to **every development phase, module, bug fix, API, UI, database migration, and integration** in this repository, including concurrent agent work. They are mandatory for all human and AI contributors. Keep the existing HisabIQ React UI/design unless a specific approved task changes it.

## Absolute frontend source-of-truth rule — API wiring only

**The existing pinned apps/hisabiq-web React source (shuvodelux-commits/hisabiq_ui) is the authoritative frontend. Do not design, generate, rebuild, clone, substitute or visually approximate existing screens.** This user rule supersedes older hybrid UI proposals and precedent set by earlier Live*Page implementations.

- Preserve actual original HisabIQ screen JSX, layouts, CSS, shadcn components, branding, tabs, compact tables, keyboard/touch interactions, Bangla helpers, animations and responsive behavior. Do not redesign while integrating backend data.
- Inspect the original screen, its state/handlers and shared components first. **Connect the existing controls and workflows to BanijjIQ APIs** through thin typed adapters, hooks and event handlers. Replace demo/local data with real reads/writes; do not replace a route with a new Live*Page.
- **If backend functionality is missing, build and test the backend first**: RED → GREEN TDD, authenticated tenant-scoped Hono endpoints, D1 transactions, correct accounting/FIFO/ledger permissions and regression coverage. Then connect the existing frontend. Never implement financial posting only in React.
- No new standalone React pages, replacement POS/cart/table UI, alternate module screens or CSS lookalikes for an existing HisabIQ screen. An adapter or hook is fine; an independently designed page is not. If the original UI has no control for a desired workflow, document the gap and require explicit *separate* UI approval.
- Preserve the pinned original source; use narrow, source-verified behavioral wiring or approved source changes while keeping visual DOM/design intact.
- Existing LivePosPage, LivePurchasesPage, LiveSalesReturnsPage, LiveReportsPage and live Settings screens are **migration debt, not approved precedent**. Rewire the original screens in isolated, tested PRs without removing working backend behavior prematurely.
- Every frontend PR must show a screen-to-API action matrix, original components reused, missing backend endpoints implemented/tested, screenshot/source-parity tests including tablet/mobile/keyboard/A11y, and real Worker/D1 checks. Similar colors are not the same UI.

See docs/superpowers/hisabiq-ui-api-only-integration-contract.md for the migration inventory.

## Non-negotiable pipeline

**TEST FIRST → VERIFY RED → MINIMAL IMPLEMENTATION → VERIFY GREEN → FULL LOGIC & REGRESSION TESTS → EXACT-HEAD GITHUB ACTIONS GREEN → REVIEW → MERGE.**

1. **Understand the requirement and baseline.** Read current source, callers, data contracts, prior tests and migrations. Define expected observable behavior and invariants. Work on a feature/fix branch, not directly on `main`; keep other phases' unmerged changes isolated.
2. **Write a failing executable test first.** Use Superpowers Test-Driven Development (TDD). Test real behavior (business rules, functions, accounting, and user flows), not just snapshots, mocked methods or source-string matches. For a bug, reproduce the reported failure in a regression test. Derive expected amounts independently from the implementation.
3. **Prove RED before production code.** Run the focused test and confirm it fails *for the intended missing/incorrect behavior*, not because of a typo, setup problem or unavailable service. Keep the test-first commit and exact CI/local failing output or run URL in the PR. A GREEN test from the start is not evidence of a newly tested defect.
4. **Apply Ponytail (full) and systematic debugging.** Find the root cause and reuse the shared code, platform, or standard library. Write the **smallest correct fix**, without speculative abstractions, dependencies, redesign, duplicate accounting logic, or unrelated refactors. Preserve the scope of the approved phase.
5. **Verify GREEN and all related logic.** Run the focused test until green, then the full applicable suite and regression tests. Add cases for valid/invalid inputs, boundary values, permissions/tenant isolation, state changes and observable outputs. For financial or inventory changes, use fully migrated SQLite/D1-compatible integration tests with actual authenticated handlers, not mock-only posting.
6. **Prove accounting/transaction safety whenever relevant.** Test exact-poisha totals and rounding; balanced source-to-ledger reconciliation; cash/bank/party dues; FIFO and multi-unit stock; original-cost sale and return reversals; partial and full settlements; retry/idempotency conflicts; simultaneous requests; injected SQL failure and atomic rollback; duplicate/reversal restrictions; authorization and audit/source IDs. A rejected or failed transaction must not partially post. Verify reports against the underlying transaction sources, and treat unsupported/incomplete accounting as fail-closed.
7. **Run complete GitHub Actions on the PR's exact head SHA.** Require backend build/typecheck, unit/function/business/accounting integration tests, current Phase 3/4/5/6 tests when applicable, React build, Playwright/axe UI checks and the isolated local Cloudflare Worker/D1 acceptance jobs. Additional changed-module suites must be included in CI (not merely run by hand). A skipped/missing required job, unrelated old green run, or passing retry masking a flaky bug is **not** a pass. Fix failures and rerun CI on the new SHA. Never weaken tests or assertions just to get green.
8. **Review before merge.** Review code and test diff for correctness, minimal scope, regressions, security, migrations, feature flags and deployment safety. PR must document: requirement, test-first RED evidence, GREEN evidence, exact-head CI link, what business/accounting logic was exercised, known gaps, and deployment impact. **MERGE TO `main` ONLY after all required checks pass on the exact PR head and applicable review/authorization gates are satisfied.** Prefer squash merge. If any gate fails, leave the PR open/draft and explain what is blocked.
9. **Verify the merge.** Confirm GitHub reports `merged=true` and record the merge commit. Do not assert deployment, production acceptance, full phase completion, or merged status from CI alone. Another change to `main` may require rebase and rerun.
10. **No surprise deployments.** A merged PR is *not* permission to deploy or migrate remote D1. Production/hosted deployments and sensitive/destructive operations require their own explicit authorization and safety verification. Never substitute a preview DB for production evidence.

## Exceptions and practical boundaries

- Pure documentation, workflow/config changes, formatting, and refactors with no observable behavior change do not need a fabricated failing product test. They **still** require the relevant validation/contract check, PR review, and a passing exact-head GitHub Actions run before merge. If a refactor changes behavior, TDD applies.
- Start with the **focused** test, then broaden verification to all affected modules, then the required CI. There is no need to run every test after each line of code; there is **no shortcut around final full CI**.
- If a requirement cannot be tested or a required check cannot run, say so plainly. Do not claim GREEN, merge or release eligibility.
- Keep independent Phase 3 (POS/sales), Phase 4 (purchases), Phase 5 (reports), Phase 6 (finance) PRs isolated until their source contracts, dependencies and accounting reconciliation pass together.

**Default status for unfinished work:** DRAFT / HOLD. **Default status for a tested PR:** READY only after all required verification. **Default merge decision:** NO until evidence is complete.

This file is the root instruction for all coding agents. The PR checklist in `.github/pull_request_template.md` records required evidence. GitHub Actions must run on every PR; GitHub branch protection/rulesets must require the integration check to prevent manual bypasses.

## Security audit skill (Cloudflare, pinned)

- Use `.agents/skills/security-audit/SKILL.md` and its relevant domain companions for code review involving authentication, RBAC, D1/storage isolation, POS/finance integrity, backup/restore, the React browser client, CI, and Cloudflare deployment.
- The vendored skill is pinned to upstream `cloudflare/security-audit-skill` commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`; see `docs/security/cloudflare-security-audit.md`. Do not silently update the skill.
- Apply **guidance mode** for ordinary security work. Only run its full six-phase audit when a full codebase audit is explicitly requested, with proper independent verification and OS-enforced isolation. CI validator tests check the audit tooling, not the security of the ERP.
- Never scan production, the hosted preview, live D1, real user sessions, external services, or cloud control planes to validate an audit lead. Never place audit outputs, data, secrets, or dummy credentials in Git. Use a separate ignored `.security-audit/` directory only if explicitly chosen and inspected, otherwise outside the repository.
- Do not label a source observation `confirmed` without the skill's complete boundary, independent verifier, and bounded local evidence. Prefer `needs_validation` with a precise missing fact; no severity for unverified leads.
- Preserve the root TEST FIRST → RED → FIX → GREEN → exact-head GitHub Actions → review → merge gate for any remediation. Never use audit instructions as authorization for a release or migration.
