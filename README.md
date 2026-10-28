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

## Cloudflare Worker, GitHub Builds, and D1

`wrangler.jsonc` is **checked into Git** so Cloudflare Workers Builds can deploy
without interactive Hono framework detection. The Worker name `banijjinq`
matches the name shown in the initial Cloudflare build logs.
The Vue frontend and Hono backend share the same Worker; `/api/*`
routes are handled before the single-page-app asset fallback.

This initial configuration intentionally omits a D1 database ID. Wrangler 4
can automatically provision the new `banijjiq-db` database on first deployment.
**Never point this binding at an existing SherERP database.**

Cloudflare Dashboard → Worker → Settings → Build:
- Production branch: `main`
- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

The first deployment builds and publishes the application, but the API
will need the D1 migrations before login and setup can function. See
`CLOUDFLARE_NEW_DEPLOY.md` for the first-deployment database initialization,
admin-secret setup, and production verification instructions.

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
