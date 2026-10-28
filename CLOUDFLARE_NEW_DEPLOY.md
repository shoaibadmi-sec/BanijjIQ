# Fresh Cloudflare deployment

This package intentionally contains no previous Cloudflare D1 database ID.

## 1. Install dependencies

```bash
npm install
```

## 2. Sign in to Cloudflare

```bash
npx wrangler login
```

## 3. First deploy

```bash
npm run cloudflare:deploy
```

Wrangler will provision a new D1 resource for the `DB` binding and deploy a new Worker named `banijjiq`.
After provisioning, Wrangler may write the generated D1 resource details back to `wrangler.jsonc`.

## 4. Apply the SherERP schema to the new remote D1

```bash
npm run cloudflare:migrate:remote
```

## 5. Verify

Open the Worker URL printed by Wrangler and then open `/api/health`.
Expected response includes `"ok": true`.

## Local Cloudflare/D1 development

```bash
npm run cloudflare:migrate:local
npm run cloudflare:dev
```

## Node + local SQLite remains available

```bash
npm run backend:migrate
npm run backend:dev
```


## BanijjIQ safety requirements

- Deploy only with the new `banijjiq-db` D1 binding. Never reuse an existing SherERP database ID.
- Configure `wrangler.jsonc` locally from `wrangler.example.jsonc`; this local file is gitignored.
- Build is included in the `cloudflare:deploy` npm script.
- Before publishing, configure a secret: `npx wrangler secret put SETUP_SECRET`.
- An initial administrator must send an `x-setup-secret` header to `POST /api/setup/admin`.
- Keep the setup secret out of source control, CI logs, and terminal history.
