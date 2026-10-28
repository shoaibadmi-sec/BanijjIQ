# SherERP dual-runtime backend

The backend business logic and API routes are shared between both supported runtimes.

## Runtime A: Node.js 22+ + local SQLite

```bash
npm install
npm run backend:migrate
npm run backend:dev
```

Default API address: `http://localhost:8787`

- Root: `http://localhost:8787/`
- Health: `http://localhost:8787/api/health`
- Database: `./data/shererp.sqlite`

Optional environment variables:

- `HOST`
- `PORT`
- `SHERERP_DB_PATH`
- `SHERERP_MIGRATIONS_DIR`

## Runtime B: Cloudflare Workers + D1

The Worker uses the existing SherERP D1 database binding from `wrangler.jsonc`.
The Cloudflare entrypoint imports only the shared Hono app. It does not import
`better-sqlite3` or other Node-only runtime code.

For local Cloudflare D1:

```bash
npm install
npm run cloudflare:migrate:local
npm run cloudflare:dev
```

For the existing remote D1 database:

```bash
npm run cloudflare:migrate:remote
npm run cloudflare:deploy
```

Backup the remote D1 database:

```bash
npm run cloudflare:backup
```

## Shared database contract

`server/db/types.ts` contains the small D1-compatible database contract used by
SherERP business logic.

- Cloudflare provides native `env.DB` (D1).
- Node provides `SqliteDatabase` backed by `better-sqlite3`.

The routes, authentication, POS, inventory, sales, purchase, ledger and finance
business logic remain shared in `server/core/handler.ts`.

## Migrations

The same SQL files in `/migrations` are used by both runtimes.

- Node tracks applied migrations in `schema_migrations`.
- Cloudflare Wrangler tracks D1 migrations in its D1 migration metadata.
