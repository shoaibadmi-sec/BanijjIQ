# HisabIQ automatic GitHub PR preview (Cloudflare Workers Builds)

**Status:** Repository configuration prepared for PR #10. Cloudflare dashboard connection, a dedicated D1 and preview administrator are still one-time external setup. A green GitHub CI run is NOT a Cloudflare deployment.

## Safety contract

- GitHub: `shoaibadmi-sec/BanijjIQ`; PR #10 branch: `feat/hisabiq-products-task1-baseline`.
- Cloudflare Worker: **`hisabiq-pr-preview`** (separate from production `shererp-new` and the existing manually controlled preview).
- D1 database: **`hisabiq-pr-preview-db`**, freshly created with demo data only. Never copy production data, UUID, business credentials or API tokens.
- Generated and ignored `wrangler.hisabiq-pr.generated.jsonc` has *no top-level D1 binding*. Only `previews.d1_databases` contains a D1 UUID verified different from production. No production routes or cron; no automatic D1 migrations on PR pushes.
- **Cloudflare does not isolate account-level D1 automatically.** Different PR previews share this **single demo D1** in this basic setup. Do not put real customer/business records in it; if per-PR databases are required, add a separate provision/migrate/cleanup service later.
- Preview URLs are public unless restricted: use **Cloudflare Access** for this Worker, and a unique Preview-only admin account and setup secret.

## One-time setup (Cloudflare dashboard)

1. **D1 → Create database:** name `hisabiq-pr-preview-db`, save its UUID. Apply existing BanijjIQ migrations **once**, after verifying the database name and UUID. From a trusted, Wrangler-authenticated operator terminal run `HISABIQ_PR_PREVIEW_D1_ID=<your-new-demo-db-uuid> node scripts/preview/build-pr-migrations-config.mjs`, inspect the generated config, then run `npx wrangler d1 migrations apply DEMO_DB --remote --config wrangler.hisabiq-pr-migrations.generated.jsonc`. The generator refuses the production database ID and never runs migrations itself. Do NOT run remote migrations with `wrangler.jsonc`: it targets production. Create a preview-only administrator using existing API setup flow and preview-only phone/password.
2. **Workers & Pages → Create Worker:** choose name `hisabiq-pr-preview`. Enable `workers.dev` and connect GitHub repository `shoaibadmi-sec/BanijjIQ` under **Settings → Build**. Use a NEW Worker, not `shererp-new`. Ensure its GitHub connection can read the pinned `shuvodelux-commits/hisabiq_ui` submodule.
3. **Settings → Build → Commands:** set root `/`, production branch `main`, and **Enable Preview Builds**.

   | Cloudflare setting | Exact command |
   | --- | --- |
   | Build | `npm run preview:pr-build` |
   | Deploy (production branch) | `npm run preview:pr-no-production` |
   | Preview (other branches) | `npm run preview:pr-deploy` |

   The production branch command is a deliberate no-op. Native Preview (not Version URL) runs only for non-main branches. For the build environment use Node.js 22 (set `NODE_VERSION=22` if necessary). The build installs the exact compatible `wrangler@4.135.0` **without modifying package-lock**, compiles the React UI and generates an isolated config. Do not use `npm run build` (old Vue UI) or `wrangler deploy` for preview.
4. **Settings → Build → Variables:** set `HISABIQ_PR_PREVIEW_D1_ID` to the newly created D1 UUID. It must be a different ID from the production database ID. This is a Cloudflare build setting; never commit the UUID or paste credentials into chat.
5. **Worker → Settings → Previews Base → Secrets:** set `SETUP_SECRET` (unique random value, at least 24 characters), used only for initial demo-user setup. Protect the Preview with **Cloudflare Access** and use separate demo credentials. If the preview uses no account yet, login cannot work until its D1 has migrations and a preview administrator.

**These account steps cannot be performed via the available GitHub connector. They need an authenticated Cloudflare owner once.** After setup, every PR push is automatic.

## Everyday workflow

- Push to PR #10 or any allowed non-main branch.
- Cloudflare builds original pinned HisabIQ React and runs `wrangler preview`. The branch gets a **stable URL that updates on every push**, and the Cloudflare GitHub integration reports it to the PR.
- Sign into that Preview with the demo account, then open `/#/app/products`.
- GitHub Actions continues running Playwright, accessibility and isolated Worker/D1 tests before any merge.

## Troubleshooting and rollback

- D1 UUID error: add the *new demo D1* to Cloudflare Build variables. **Never** reuse the ID in `wrangler.jsonc`.
- API missing tables: apply migrations to `hisabiq-pr-preview-db` **once** and create the preview user. Do not make every unreviewed branch auto-migrate the shared DB.
- Build cannot find React: check GitHub submodule access and `npm run react:build` logs.
- Missing DB binding: check generated `previews.d1_databases` and that the new Worker uses the current Worker Previews model.
- Wrong URL: use the **branch Preview** URL from the Cloudflare/GitHub check, not a Version URL.
- To stop auto previews, disable **Preview Builds** or disconnect only this separate preview Worker. Do not touch production `shererp-new` or D1.

## Verification

`node --test tests/pr-preview.contract.test.mjs`

`npm run react:build`

GitHub CI also runs the existing manual-deployment safety contracts. Remote Cloudflare preview success and URL can only be verified after the Cloudflare GitHub connection is authorized.

Docs: https://developers.cloudflare.com/workers/previews/ ; https://developers.cloudflare.com/workers/previews/configuration/ ; https://developers.cloudflare.com/workers/previews/resources/ ; https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
