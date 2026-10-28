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

## Cloudflare Worker and D1

`wrangler.example.jsonc` is a safe template; the previous project's live database identifier has deliberately not been published. Create a separate Cloudflare D1 database for BanijjIQ, then copy the template to the ignored `wrangler.jsonc` and set your own D1 database ID.

```bash
cp wrangler.example.jsonc wrangler.jsonc
# Edit wrangler.jsonc with your new D1 database ID
npm ci
npm run build
npm run cloudflare:migrate:remote
# Required before public deployment: create a secret using the interactive Wrangler prompt
npx wrangler secret put SETUP_SECRET
npm run cloudflare:deploy
```

Verify the deployment and database configuration carefully before applying remote migrations.

## Data protection

Only project source code, SQL schema migrations and development configuration examples are versioned. Real SQLite databases, SQL backups, `.wrangler` state, local credentials, dependencies, built output and downloaded patch archives are excluded. Keep those backups in secure storage and never commit credentials.

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
