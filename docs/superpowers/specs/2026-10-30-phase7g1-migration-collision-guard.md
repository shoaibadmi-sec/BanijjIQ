# Phase 7G1 — Safe inventory migration sequencing

## Observed conflict
Independent active Phase 7 pull requests introduce different migration files with the same numeric version:
- PR #65: `0060_inventory_loss_journal.sql`
- PR #95: `0060_bundle_cash_full_returns.sql`
- PR #72: `0061_physical_stocktaking.sql`
- PR #97: `0061_bundle_partial_returns.sql`

SQLite `schema_migrations` uses the *full filename* as its key; Cloudflare D1 also processes SQL migration files. Numeric duplication undermines the intended ordering and makes combined branch release unsafe. The existing main migration directory has no such conflicts.

## Intended guard
A read-only, dependency-free Node check rejects repeated **numeric prefixes** among SQL migration filenames, regardless of differing descriptive suffixes. It emits each conflicting filename in diagnostics, returns nonzero, and does not migrate, create, or modify any database. Existing non-contiguous version history is supported: 0023, 0030, 0040 etc. may be absent.

Run the guard:
- before executing any checked-in GitHub CI tests or local D1 migration commands;
- before the npm `backend:migrate`, `cloudflare:migrate:local`, and `cloudflare:migrate:remote` scripts;
- as a small test with synthetic conflicting branch fixtures.

Do NOT renumber or rewrite an already-applied migration. For these still-unmerged Phase7 drafts, allocate unique unused numbers and re-run cross-branch migrations/tests on a disposable database after integration.

## No changes allowed
No UI changes, product or accounting logic rewrites, database migrations, remote D1 writes, bundle enablement, or merging other PRs. Strict RED→GREEN TDD; draft PR held until exact-head GitHub CI and review.
