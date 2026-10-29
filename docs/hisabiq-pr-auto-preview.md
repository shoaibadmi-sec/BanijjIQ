# Automatic PR previews on the EXISTING HisabIQ React Cloudflare Worker

**Existing stable deployment (leave it unchanged):** https://banijjiq-hisabiq-react-preview.shoaibadmisec.workers.dev/

**Existing Worker:** `banijjiq-hisabiq-react-preview`  
**Existing shared D1:** `banijjiq-hisabiq-react-preview-db`  
**Production ERP (never touched):** `shererp-new` and `shererp-new-db`

This uses Cloudflare **Worker Previews** under the existing React Worker, not a new Worker, not a new database, not a GitHub Actions deployment that overwrites the stable preview. Each PR branch gets a **stable PR URL**, automatically updated with its latest pushed commit; open that URL with `/#/app/products`. The stable root URL above stays on its current deployed version.

## One-time Cloudflare dashboard configuration

1. Open **Workers & Pages → banijjiq-hisabiq-react-preview → Settings → Build**. Connect GitHub repository `shoaibadmi-sec/BanijjIQ` if it is not already connected. If Cloudflare shows **Set up Worker Previews**, review the irreversible switch and select it; Cloudflare may use the older preview model for existing Workers. Do not change the production ERP Worker.
2. Under **Branch control**, enable **Preview Builds** for non-production branches. Cloudflare needs to build the **branch's actual source** (do not use a prebuilt artifact from PR #9 or the live Worker). A PR whose source predates the React integration cannot produce this React UI: bring the pinned HisabIQ React integration and these configuration scripts into its branch first.
3. Set the following **Build commands** for the **existing** React Worker:

   | Setting | Value |
   | --- | --- |
   | Build command | `npm run preview:pr-build` |
   | Preview command | `npm run preview:pr-deploy` |
   | Production/main branch deploy command | `npm run preview:pr-no-production` |
   | Root | `/` |
   | Node version | `22` |
   | Preview Builds | **Enabled** |

   `main` currently contains the legacy Vue ERP, **not** the React integration or these scripts. This is a draft PR configuration: to make *all future* React branches previewable, these scripts must be brought into their shared base branch. Until then, configure the build only for branches that already contain the React integration. The production/main command does **not** deploy or overwrite the existing stable React URL; even if the build is triggered, a failing legacy build cannot alter that live URL.
4. In the **existing Worker's Build variables/secrets** set `HISABIQ_PREVIEW_D1_ID` to the UUID of **`banijjiq-hisabiq-react-preview-db`**. This is the SAME UUID already used by the manually deployed React preview, not the production ERP D1. Use the existing stored UUID from Cloudflare/GitHub settings; do not post it in chat or commit it to GitHub. The generator refuses the production D1 UUID.
5. Under this Worker's **Settings → Previews Base**, use the same **preview-safe** setup secret as appropriate (`SETUP_SECRET`) or a distinct preview secret. Production-level secrets are **not inherited** by Worker Previews. Secure the preview hostnames with **Cloudflare Access** before using credentials or sharing links.

**No fresh D1 creation, schema migrations or administrator setup are needed merely to reuse an already-working preview database.** The D1 schema and preview account already exist; do not reset or duplicate them. This automatic preview pipeline NEVER runs remote D1 migrations, never posts test sales, and never creates accounts.

## What happens automatically

- You push a commit to a trusted branch used by PR #10 or another compatible React PR.
- Cloudflare Workers Builds compiles the branch and runs `wrangler preview` against **`banijjiq-hisabiq-react-preview`**.
- Cloudflare publishes a distinct branch URL in its **Previews** list and normally comments the URL on the corresponding GitHub PR. Each PR's URL keeps serving the newest deployment of that branch. The existing https://banijjiq-hisabiq-react-preview.shoaibadmisec.workers.dev/ remains unchanged.
- All branch previews connect to **the same existing D1**, so they see the current product and login records. **Warning:** product edits, sales, returns and stock changes from ANY branch can change the same preview database for ALL branches. Use test inventory only and enable Cloudflare Access. Disable unsafe workflows before letting untrusted contributors run previews.
- GitHub's independent Playwright/SQL CI checks still gate merges. A successful branch preview does NOT itself mean accounting/permission changes are safe.

## Source-controlled safety

`scripts/preview/build-pr-config.mjs` creates **ignored** `wrangler.hisabiq-pr.generated.jsonc`, with the **existing Worker name** and the existing D1 UUID bound **only** in `previews.d1_databases`. No top-level D1 is present: it cannot bind production ERP D1 by accident. The preview build does not apply migrations. The production branch deploy command is an explicit no-op. The original `wrangler.jsonc` and the manual-only workflow for the stable React preview have not changed.

Verify locally or in GitHub Actions:

```bash
node --test tests/pr-preview.contract.test.mjs
node --test tests/preview-deploy.contract.test.mjs
npm run react:build
```

**Rollback:** Turn off Preview Builds for the existing React Worker. The existing deployed root URL, D1 records, original protected preview workflow and production ERP remain unchanged. Do not delete the Worker or its D1.

**Cloudflare account access is still required once** to connect/enable Preview Builds and set the existing D1 UUID in the Worker's build environment; the GitHub app cannot change that Cloudflare dashboard setting or confirm a live PR URL.

Official docs: https://developers.cloudflare.com/workers/previews/ ; https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/ ; https://developers.cloudflare.com/workers/previews/resources/ .
