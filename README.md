# BanijjIQ

Imported source snapshot of the local **SherERP-new** application, originally developed with Vue 3, TypeScript, Vite, Hono and Cloudflare Workers + D1. A Node.js + SQLite local runtime is also supported.

This is a source-code import, not a database backup or a production deployment. Internal module naming retains SherERP to preserve the application code unchanged.

## Local development

Requires Node.js 22+.

```bash
npm ci
npm run backend:migrate
BANIJJIQ_SETUP_SECRET="<choose-a-random-secret>" npm run backend:dev
# In another terminal:
npm run dev
```

The Node API defaults to port 8787, and Vite serves the frontend separately. See `server/README.md` for runtime details.

## Existing Cloudflare Worker + GitHub development

This repository is being connected to the **already deployed**
Cloudflare Worker `shererp-new`, not a new `banijjinq` Worker.
The production D1 binding is `DB` → `shererp-new-db`.
The version-controlled `wrangler.jsonc` includes the UUID taken from
the original local `SherERP-new` deployment configuration. Before rollout,
**verify the database UUID in the live Cloudflare Worker bindings**.

The existing database may contain real users and transactions.
Do not create a replacement D1 database, reset it, or run all migrations
against it without a schema audit and a secure backup.

**Safe first GitHub rollout (Cloudflare → shererp-new → Settings → Builds):**

- Connected repository: `shoaibadmi-sec/BanijjIQ`
- Production branch: `main`
- Build command: `npm run build`
- **First deployment command: `npx wrangler versions upload`**
  (creates an inactive version for comparison, not an active deployment)

The application Worker entrypoint and frontend assets are built together.
After reviewing the new version and checking D1 schema compatibility,
you can explicitly promote it through Cloudflare Deployments.
Only after production verification should you change the deploy command
to `npx wrangler deploy` to enable automatic production updates.

See `CLOUDFLARE_NEW_DEPLOY.md` for the detailed safe-adoption procedure.
Do not delete `shererp-new` or `shererp-new-db`.
The extra `banijjinq` Worker, if still present, is a separate installation.

## Data protection

Only project source code, SQL schema migrations and the non-secret Wrangler deployment configuration are versioned. Real SQLite databases, SQL backups, `.wrangler` state, local credentials, dependencies, built output and downloaded patch archives are excluded. Keep those backups in secure storage and never commit credentials.

## Original project

Source snapshot: `/run/media/shoaib/Program/Backup Project 11-9-26/SherERP-new` on the developer's local workstation (reviewed October 28, 2026).


## Secure first-administrator setup

**A fresh deployment does not permit anonymous admin creation.** The setup endpoint
requires the private `SETUP_SECRET` bound through Cloudflare Workers secrets.
Never commit this value into GitHub or a Wrangler config file.

After deploying and initializing the empty database, create the first administrator by
calling `POST https://YOUR-WORKER.workers.dev/api/setup/admin` with the
`x-setup-secret` request header and a JSON body containing `fullName`,
`phone`, and `password`. Keep the secret out of shell history and shared logs.
After the first administrator exists, further setup attempts are rejected.
You may remove the `SETUP_SECRET` binding after the initial setup.

The Node.js runtime reads the equivalent `BANIJJIQ_SETUP_SECRET` environment
variable for local bootstrap.
