# Adopt existing SherERP Cloudflare deployment with GitHub

This project is **not** a new database installation.
The existing production Worker is `shererp-new`, and the original
`SherERP-new` archive defines D1 binding `DB` → `shererp-new-db`.
Its stored D1 UUID was used to prepare `wrangler.jsonc`.
**Confirm this UUID in the Cloudflare dashboard before merging.**
The old Worker and real business data must be preserved.

## Step 1: Configure safe GitHub Builds

Cloudflare Dashboard → Workers & Pages → `shererp-new` → Settings → Builds.

Confirm:
- Repository: `shoaibadmi-sec/BanijjIQ`
- Production branch: `main`
- Build command: `npm run build`
- **Deploy command: `npx wrangler versions upload`** (initially)

This last setting is essential. It uploads a test version without activating
it for production traffic. Do not use `npx wrangler deploy` until the
schema and behavior have been reviewed.

Keep any existing Cloudflare secrets, custom domains, and route settings.
Do not overwrite or delete them.

## Step 2: Verify live D1 binding and back up

In Cloudflare → Workers & Pages → `shererp-new` → Settings → Bindings,
check the `DB` D1 binding refers to `shererp-new-db`.

Then open Cloudflare → Storage & databases → D1 → `shererp-new-db` and
compare the database UUID with the one in this branch's
`wrangler.jsonc`. If any value differs, **stop before merging**.

Back up production D1 before making any schema or code changes. On a machine
authenticated into the *same Cloudflare account*, you can use:

```bash
npx wrangler login --device
npx wrangler d1 export DB --remote --output=/path/to/secure/private/shererp-before-github.sql
```

Keep the backup outside public GitHub, local `dist`, and shared cloud links.
Never run the destructive D1 database delete command.

## Step 3: Read-only schema and migration audit

Use the authenticated Wrangler client and the verified production binding:

```bash
npx wrangler d1 migrations list DB --remote
npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Compare actual tables, migration history, and the 26 SQL migration files
in GitHub. **Do not blindly run `migrations apply --remote`** against
the already populated ERP database. Migrations must be audited for
compatibility, backups, and data preservation first.

## Step 4: Merge configuration and preview the inactive version

Only after confirming the production Worker and database identifiers,
merge the GitHub alignment PR into `main`.

Cloudflare Workers Builds will create an **inactive version** when the
deploy command is `npx wrangler versions upload`.
Use Cloudflare → `shererp-new` → Deployments to examine its Version URL.

Verify the UI, `/api/health`, `/api/setup/status`, authenticated login,
products, POS, purchases, ledgers, and non-destructive reporting.
Version URLs connected to the same D1 may access production data,
so **do not perform test sales, returns, edits or writes** during preview.

## Step 5: Controlled production release

When the verified version works, promote it through Cloudflare Deployments.
Confirm application behavior and existing business records are unchanged.
Keep the previous version available for rollback.

Then, when automatic production deployments are desired, change
Cloudflare → `shererp-new` → Settings → Builds → Deploy command
to `npx wrangler deploy`. New GitHub pushes to `main` will
then update production automatically. Prefer pull-request review
and protected `main` for future changes.

## Duplicate worker handling

The newer `banijjinq` Worker (if it still exists) is separate from
`shererp-new`. It may be removed after its bindings are checked.
**Never delete `shererp-new` or `shererp-new-db`.**
Do not delete any D1 databases as part of this GitHub connection.

## First-admin setup

A populated production database should already have users. The initial
admin bootstrap endpoint is only for a genuinely fresh database and
requires `SETUP_SECRET`. Do not use it to recreate existing users.
If the existing Cloudflare Worker has extra secrets, preserve them.
