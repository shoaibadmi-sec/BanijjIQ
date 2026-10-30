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

## Safety and acceptance

- Known gaps / remaining HOLD:
- Database migrations or feature flags:
- Hosted/production deployment: **NOT INCLUDED** unless independently approved.
- [ ] I will **not merge** this PR until all required exact-head GitHub Actions checks are GREEN and review/authorization gates are satisfied.
