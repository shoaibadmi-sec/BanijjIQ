# GitHub UI checks — HisabIQ React + BanijjIQ API

This is a **no-production-data** browser test harness, using the already-installed
\`playwright\` and \`axe-core\` dependencies from the pinned HisabIQ_UI frontend.

## Automatic PR workflow
The \`HisabIQ React / BanijjIQ API integration\` workflow builds React and the backend,
runs the product catalog database regression, and launches headless Chromium after the
production frontend build. Browser cases use synthetic, intercepted \`/api/*\` responses
and never contact a Cloudflare deployment. No credentials or real customer data are used.

Checks include sign-in enforcement, Product/Editor and POS rendering, 390px phone,
768px tablet, 1024px laptop and 1440px desktop; light/dark; search/clear;
F2 focus, cart add, confirmed single-unit sale, one mocked POST, saved receipt;
WCAG 2.0/2.1 A and AA axe-core reporting and runtime exceptions.

Screenshots are **review artifacts**, not approved golden baselines. Do not update
pixel baselines automatically from a change being tested. Human review of screenshots
is required for visual parity against the approved HisabIQ_UI screenshots.
\`documentWidth > viewport\` is a reported warning for review (internal cart/table
scrolling is intentional). Critical accessibility failures and any runtime errors fail CI.
Other accessibility findings are saved in the JSON artifact so regressions remain visible.

## Inspect a run
Open GitHub Actions → the React integration run → the
\`hisabiq-react-ui-checks\` artifact (retained 14 days).
View \`ui-check-results.json\`, the \`*.png\` files, and \`server.log\`.
The job fails if a required interaction or rendering invariant breaks.

## Run locally
\`\`\`bash
git submodule update --init --recursive
npm run react:build
cd .generated/hisabiq-web
npx playwright install chromium
cd ../..
node ui-checks/run.mjs
\`\`\`
This uses the compiled Vite preview at 127.0.0.1:4173, never the production Worker.

## Important limits
This is UI + mocked-API testing, **not** a real D1 accounting e2e test. It cannot
certify posting, FIFO, payments, serials, expiry, refunds or transaction rollback
against a database. Those require a separate isolated preview D1 or disposable SQLite
integration environment. PR #9 must remain draft until accounting verification.
