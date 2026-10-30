# Phase 5G7 — Reports release acceptance (GitHub-only)

**Decision: HOLD hosted/production release.** Local CI passed for the reviewed merged Reports changes, but this is not a hosted-preview acceptance or a production accounting sign-off. Business Audit Phase 5F remains deferred for redesign.

## Implemented and merged on `main`
| Scope | Pull request | Test evidence |
| --- | --- | --- |
| Report Library search reset, source-backed read-only sales invoice | [#25](https://github.com/shoaibadmi-sec/BanijjIQ/pull/25) | [CI 41022569033](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41022569033) |
| 50/100 pagination, page jump, source RBAC | [#27](https://github.com/shoaibadmi-sec/BanijjIQ/pull/27) | [CI 41024908891](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41024908891) |
| Product margin vs complete Profit & Loss contracts (both fail closed) | [#29](https://github.com/shoaibadmi-sec/BanijjIQ/pull/29) | [CI 41030330726](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41030330726) |
| Return-specific immutable FIFO restoration | [#30](https://github.com/shoaibadmi-sec/BanijjIQ/pull/30) | [CI 41033822316](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41033822316) |
| Return header ↔ invoice/line/lot source parity | [#32](https://github.com/shoaibadmi-sec/BanijjIQ/pull/32) | [CI 41037615975](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41037615975) |
| Historical FIFO stock lot ↔ sold product source parity | [#34](https://github.com/shoaibadmi-sec/BanijjIQ/pull/34) | [CI 41038686048](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41038686048), **attempt 2**; attempt 1 had a separate POS browser failure |
| POS customer-name preservation for blank legacy record; passive D1 diagnostic trace | [#37](https://github.com/shoaibadmi-sec/BanijjIQ/pull/37) | [CI 41043344333](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/41043344333) |

These are **PR-head local CI** results. A squash merge creates a new `main` commit; do not infer a green post-merge or hosted check from the source PR's run.

## Design and accounting boundaries
- Preserve pinned `apps/hisabiq-web` React submodule, original compact HisabIQ UI and exactly **Dashboard / Report Library** main tabs.
- All live Reports API reads require authentication and `reports.view`; sales invoice drill-down additionally requires `pos.view`. No report GET writes to D1 or falls back to demo data.
- Historical FIFO allocation, return-level restoration, invoice and product source IDs must reconcile before displaying COGS or profit. Any missing/mismatched source means `incomplete`, with **null** unsupported totals, not invented zero.
- Invoice-cohort `profit` is **not** a full ledger P&L or product gross-profit report. Keep `product-profit`, `profit-loss` and Business Audit unavailable pending independently approved, reconciled source contracts.
- Stock/dues and bank current balances are current snapshots, not historical as-of balances. Historical ageing and complete audit remain unavailable.
- No change to existing POS design, sale posting or financial data from this acceptance document.

## Required checks per future merge candidate
1. `node --test react-integration/tests/reports-source-parity.test.mjs` and React/POS source parity tests.
2. `node --import tsx --test tests/reports-*.integration.test.ts` — real migrated SQLite source/return/FIFO/expense/dues reconciliations, RBAC and no writes.
3. `node d1-checks/run.mjs` — isolated local Wrangler Worker + D1; authenticate, test actual transaction sources and no mutation from report GET.
4. `node ui-checks/run.mjs` — responsive 390/768/1440 Playwright, screenshot, axe, keyboard and source navigation.
5. `npm run backend:build` and `npm run react:build`; verify exact-head **all required jobs successful**. Never count skipped hosted-preview jobs as passed.

## Outstanding acceptance blockers
- **[Issue #35](https://github.com/shoaibadmi-sec/BanijjIQ/issues/35)** remains open: real-D1 POS second-sale customer name was intermittently cleared; #37 adds a narrower guard but earlier D1 CI failed with the same symptom. A single subsequent green run is not sufficient to close the race investigation.
- **Phase 3 Store Credit/split tenders:** draft dependency chain [#20](https://github.com/shoaibadmi-sec/BanijjIQ/pull/20), [#24](https://github.com/shoaibadmi-sec/BanijjIQ/pull/24), [#26](https://github.com/shoaibadmi-sec/BanijjIQ/pull/26), [#31](https://github.com/shoaibadmi-sec/BanijjIQ/pull/31), [#33](https://github.com/shoaibadmi-sec/BanijjIQ/pull/33). Do not certify Store Credit liability, source-exact split refunds or tender accounting from unmerged branches.
- **Phase 4 Purchase/Supplier:** draft [#21](https://github.com/shoaibadmi-sec/BanijjIQ/pull/21); don't certify purchase posting, supplier settlement or purchase-return reconciliation until independently accepted.
- **Phase 6 Finance:** draft [#28](https://github.com/shoaibadmi-sec/BanijjIQ/pull/28); no assumed completed bank/finance reconciliation.
- Separate hosted-preview deployment and read-only acceptance have **not** run; CI jobs `deploy-hosted-preview` and `accept-hosted-preview` are intentionally skipped. Production deployment, migrations, and enabling `/api/reports/v2/audit` remain blocked.

## Next release decision
Only after the accounting dependency branches are verified and merged, re-run cross-module real-D1 money-source tests on the merged candidate, resolve/reproduce #35 deterministically, check source drill-down/RBAC and hosted read-only acceptance with explicit authorization. **Do not deploy or mark Phase 5 complete based solely on green local PR CI.**
