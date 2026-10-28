# Safe Preview Login for Unmerged Bundle PRs

The Workers Preview URL serves a **separate** Cloudflare Preview, not the production `shererp-new` deployment. Cloudflare Previews do not inherit the production `DB` binding. This repo has two explicitly different D1 targets:

| Runtime | D1 database | Purpose |
|---|---|---|
| Production | `shererp-new-db` | Existing real business data. Never test migrations or seed fixtures here. |
| Bundle PR Preview | `shererp-bundle-preview-db` | Empty, isolated staging D1, initialized from versioned migrations. |

- `wrangler.jsonc` **top-level** `d1_databases` remains production unchanged. Only `previews.d1_databases` binds to the separate D1.
- `wrangler.preview-migrations.jsonc` uses an independently named `PREVIEW_DB` binding and the exact same staging UUID. No production ID is contained in that migrations-only file.
- On a clean Preview database, use `npx wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc`. **Never** run `d1 migrations apply DB --remote` for Preview setup.
- Deploy without merging or promoting production using `npx wrangler preview --name feat-mohim-bundles-sale-fifo` (Wrangler 4.135+).
- Set a Preview-only `SETUP_SECRET` via `npx wrangler preview secret put SETUP_SECRET --name feat-mohim-bundles-sale-fifo`. Do not commit its value.
- First login shows Initial Admin Setup. The user can select their own Preview-only phone/password and enter the secret. They should not reuse production secrets or passwords.
- Preview URLs are public unless protected by Cloudflare Access. Keep only synthetic test data; never export real production tables, auth hashes, credentials or customer records into Preview.
- `main` and active Worker stay unchanged; branch tests should remain isolated. Merging the PR is **not** needed to preview.
