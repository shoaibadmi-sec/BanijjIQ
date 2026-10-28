# Deploy BanijjIQ to Cloudflare Workers + D1

This project serves Vue static assets and the Hono API from **one Cloudflare Worker**.
Use a **new D1 database**. Never bind an existing SherERP production database.

## 1. Authenticate from CachyOS

```bash
cd /home/shoaib/BanijjIQ
npx wrangler login --device
npx wrangler whoami
```

Use the device authorization URL and code shown by Wrangler; no tokens should be pasted into this repository.

## 2. Create an isolated D1 database

```bash
npx wrangler d1 create banijjiq-db --location apac
```

Copy `wrangler.example.jsonc` to the ignored local `wrangler.jsonc`, and replace
`REPLACE_WITH_YOUR_D1_DATABASE_ID` with the new UUID from Cloudflare's output.
Verify the Worker name is `banijjiq`, database name is `banijjiq-db`,
`DB` is the binding, and `assets.run_worker_first` contains `/api/*`.
Do **not** use the old SherERP Worker or database IDs.

## 3. Build and initialize the new database

```bash
npm ci
npx wrangler d1 migrations list DB --remote
npx wrangler d1 migrations apply DB --remote
```

Do not run the remote migration command against an existing business database.
The migration collection includes all 26 versioned SQL migrations.

## 4. Publish the Worker

```bash
npm run cloudflare:deploy
```

The deploy script builds the Vue frontend before publishing.
Verify the Worker URL printed by Wrangler, `/api/health`, and the
`/api/setup/status` endpoint. The fresh database initially has no admin users.

## 5. Set up the first administrator securely

`POST /api/setup/admin` is **denied by default** even on a brand-new database.
For a short-lived bootstrap period, set the private Cloudflare Worker secret:

```bash
npx wrangler secret put SETUP_SECRET
```

Use a strong random value entered into the prompt (not hard-coded in source).
The initial administrator must make a JSON POST request to
`https://YOUR-WORKER.workers.dev/api/setup/admin` containing `fullName`,
`phone`, and `password`, with the `x-setup-secret` header matching this secret.
Do not paste the secret into a chat, file, repository, or logged shell command.

Once the admin exists, further setup requests are rejected by the application.
Remove the temporary secret afterwards with `npx wrangler secret delete SETUP_SECRET`.

The existing UI's first-admin form does not send the secret automatically;
complete this protected one-time step via an authenticated HTTP request first,
then log in through the UI.

## 6. Verify production

Check the public frontend and `/api/health`. Test an authenticated login,
products, POS, and a non-destructive read workflow.
Do not import actual business data or run sales transactions until backup and
authorization policies are reviewed.

## For local development

```bash
npm run cloudflare:migrate:local
npm run cloudflare:dev
```

To enable first-admin setup under the Node runtime,
set `BANIJJIQ_SETUP_SECRET` in the Node process environment.

## Security notes

- Do not commit `wrangler.jsonc`, secrets, local databases, or SQL backups.
- This is a fresh installation, not a migration of real SherERP business data.
- Avoid publicly sharing the Worker URL until an administrator is configured.
