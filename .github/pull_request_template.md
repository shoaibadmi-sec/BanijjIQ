## Change / phase

- Module and task:
- What behavior or invariant is changed:
- Existing source/contract reviewed:

## Mandatory RED → GREEN → full CI evidence

- [ ] **TEST FIRST:** executable regression/function/business test added before production code, or documented docs/config-only exception.
- [ ] **RED observed:** test failed for the intended behavior before the fix (not a setup error). Test-first commit and RED run/log:
- [ ] **Ponytail:** root cause identified; minimal shared fix; no unrequested abstractions or UI redesign.
- [ ] **GREEN observed:** focused test and all affected logic/transaction tests passed. Exact command/log:
- [ ] **Financial correctness, if applicable:** cash/bank, party ledger, FIFO/return, poisha rounding, permissions, idempotency/concurrency, rollback, source reconciliation tested.
- [ ] **FULL TEST SUITE:** all applicable backend, UI/Playwright/axe, and isolated Worker/D1 tests ran; no required case removed or weakened.
- [ ] **EXACT-HEAD CI GREEN:** GitHub Actions run (URL), PR head SHA and all required check conclusions verified:
- [ ] **Review and merge gate:** diff reviewed for permissions, security, tenant isolation, migration, and deployment impact; no unresolved failing/flaky check.

## HisabIQ_UI source fidelity and backend parity (mandatory for frontend/API work)

- [ ] **Authoritative source:** identified the pinned original HisabIQ_UI React page, components and workflows; no new or replacement UI design created.
- [ ] **All UI retained:** original markup/layout/style/responsiveness, tables, filters, forms, dialogs, editing, keyboard and touch actions are preserved, including visible/hidden/empty/error states.
- [ ] **Backend-first:** enumerated each original feature/action and the corresponding authenticated BanijjIQ API contract. Missing APIs were implemented and business-tested **before** wiring the frontend; gaps remain documented as blockers, not fake completion.
- [ ] **Real database writes:** create/update/delete/return/payment actions post through D1-backed services with RBAC, tenant scope, audit, idempotency and transactional rollback where applicable. No UI-local simulated posting, fake balance, or demo fallback.
- [ ] **Visual parity:** baseline-versus-integrated Playwright screenshots and visual comparisons at 390px, 768px and 1440px; no unapproved layout/component change.
- [ ] **Interaction parity:** original UI workflow integration/E2E tests, failed-API behavior, accessibility/axe, mobile/tablet/desktop, and authenticated Worker/D1 business tests.
- [ ] **Deviation audit:** checked for generated JSX replacement, altered tab/navigation, hidden or simplified original features. Any existing deviation is tracked for remediation, not treated as a design reference.
- Original UI source commit/component paths:
- API mapping / missing-backend functionality implemented:
- Visual comparison evidence and tested workflows:
- Remaining source-fidelity blockers:

## Safety and acceptance

- Known gaps / remaining HOLD:
- Database migrations or feature flags:
- Hosted/production deployment: **NOT INCLUDED** unless independently approved.
- [ ] I will **not merge** this PR until all required exact-head GitHub Actions checks are GREEN and review/authorization gates are satisfied.
