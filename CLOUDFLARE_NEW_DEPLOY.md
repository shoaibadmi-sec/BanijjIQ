# BanijjIQ: Deploy from GitHub to Cloudflare Workers

**This guide is for the fresh `shoaibadmi-sec/BanijjIQ` project only.**
Do not connect to existing SherERP Workers or production databases.

## 1. Connect the GitHub repository

Cloudflare → Workers & Pages → the Worker → Settings → Build:
- Repository: `shoaibadmi-sec/BanijjIQ`
- Production branch: `main`
- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

The original Cloudflare build log showed the Worker name **`banijjinq`**.
That exact value appears in the checked-in `wrangler.jsonc` so the next
GitHub build deploys to the same Worker. Rename both together later if desired.

## 2. Deploy from GitHub

`wrangler.jsonc` is **version-controlled**. Its presence avoids Wrangler
trying to auto-configure Hono during non-interactive CI deployment.
The file declares:
- Hono Worker entrypoint `server/runtime/cloudflare.ts`
- Vue assets from `./dist`
- API-first routing (`/api/*`) with SPA fallback
- a new D1 binding `DB` targeting `banijjiq-db`

Because no `database_id` is specified, current Wrangler versions can
**automatically provision a separate D1 database** on the first deployment.
This is Cloudflare's automatic provisioning feature, not a reference to a
previous SherERP database. Confirm the provisioned database in Cloudflare D1.

## 3. Initialize the new D1 database (required after deployment)

A successful Cloudflare **build or deployment is not a completed ERP
installation**. The new D1 database starts without tables.
Only run migrations against a confirmed, newly provisioned `banijjiq-db`.

Copy the D1 **Database ID** from Cloudflare → Storage & databases → D1.
Add `"database_id": "THE_NEW_DATABASE_UUID"` to the `DB` binding in the
version-controlled `wrangler.jsonc`, then commit the change.

From a workstation authenticated to the **same Cloudflare account**:

```bash
cd /home/shoaib/BanijjIQ
npx wrangler login --device
npx wrangler d1 migrations list DB --remote
npx wrangler d1 migrations apply DB --remote
```

`npx wrangler d1 migrations apply DB --remote` applies the project's
26 SQL migration files. **Do not run it with an old SherERP database UUID.**
Alternatively, a one-time protected deployment workflow can run these
commands after the new database ID is committed.

## 4. Secure first administrator

The first-admin creation endpoint is denied by default until `SETUP_SECRET`
exists. Set a strong random value in Cloudflare Worker → Settings →
Variables and Secrets → add **Secret**, with name `SETUP_SECRET`. Never put
its value in GitHub, Wrangler config, terminal history, or this chat.

After schema initialization, create the first administrator through
`POST /api/setup/admin`, sending a JSON body with `fullName`, `phone`,
and `password`, and a matching `x-setup-secret` request header.
The UI's initial setup form does not send the secret by itself.

Once the administrator exists, subsequent attempts are rejected; you can
remove the temporary secret afterwards.

## 5. Verify

Open the Worker URL printed by Cloudflare. Verify:
- `/` returns the Vue frontend
- `/api/health` returns `{"ok":true,...}`
- `/api/setup/status` works after D1 initialization
- Authenticated login, products and read-only ledger workflows work

Do not use live business records until database backups and controls are
validated. The imported repository does not contain prior business data.

## Local development

```bash
npm ci
npm run build
npm run cloudflare:migrate:local
npm run cloudflare:dev
```

Local first-admin setup needs a `.dev.vars` secret `SETUP_SECRET` or
`BANIJJIQ_SETUP_SECRET` for the Node runtime. Never commit local secrets.
