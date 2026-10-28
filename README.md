# BanijjIQ

Imported source snapshot of the local **SherERP-new** application, originally developed with Vue 3, TypeScript, Vite, Hono and Cloudflare Workers + D1. A Node.js + SQLite local runtime is also supported.

This is a source-code import, not a database backup or a production deployment. Internal module naming retains SherERP to preserve the application code unchanged.

## Local development

Requires Node.js 22+.

```bash
npm ci
npm run backend:migrate
npm run backend:dev
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
npm run cloudflare:deploy
```

Verify the deployment and database configuration carefully before applying remote migrations.

## Data protection

Only project source code, SQL schema migrations and development configuration examples are versioned. Real SQLite databases, SQL backups, `.wrangler` state, local credentials, dependencies, built output and downloaded patch archives are excluded. Keep those backups in secure storage and never commit credentials.

## Original project

Source snapshot: `/run/media/shoaib/Program/Backup Project 11-9-26/SherERP-new` on the developer's local workstation (reviewed October 28, 2026).
