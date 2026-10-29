# Task 7 acceptance — original HisabIQ Products + Mohim D1 workflows

**Date:** 2026-10-29  
**Draft PR:** [#10](https://github.com/shoaibadmi-sec/BanijjIQ/pull/10)  
**Verified implementation commit:** `58f67936b598ab647d218ec76bf76d3d33c517d0`  
**GitHub Actions:** [run 40842483907 — SUCCESS](https://github.com/shoaibadmi-sec/BanijjIQ/actions/runs/40842483907)  
**Disposition:** Automated acceptance PASS; **independent human visual/business sign-off is still required before merge or any hosted deployment**.

## Evidence

- Original source revision: `shuvodelux-commits/hisabiq_ui@9a8dc1ac4e85ac4e60f254e068bd67c2a805673f`. Original submodule remains clean, and generated Products source is refused on unexpected Git blob SHA.
- Source contract, pinned JSX marker and route/build-copy tests: PASS. Original PageHeader, MotionTabList, compact Product rows, search, category/stock filtering, stock-value column, column picker, and three-dot contextual actions are retained.
- Backend Node tests and React build: PASS (including 30/30 and 15/15 integrated test suites).
- Mocked Playwright API acceptance: **25 passed, 0 failed**. Captured **21 screenshots** and **9 axe audits**: Products at 390, 768, 1024 and 1440 CSS pixels in light and dark themes, plus mobile POS. **0 critical or serious accessibility violations, 0 JS console errors, 0 layout warnings**.
- Real Chromium → local Cloudflare Worker → isolated D1: local worker suite **13 passed, 0 failed**; Phase 13 browser/accounting **11 passed, 0 failed**. SQL reconciliation for inventory, FIFO lots/movements, sales, customer due, serials, expiry, vendor sourcing and cash refunds succeeded.
- The local D1 config is `wrangler.d1-ci.jsonc` with a dedicated fixture UUID and `--local --persist-to`. No production Worker, hosted preview or remote D1 API was contacted or mutated.
- Evidence artifacts in the same successful GitHub run: `hisabiq-react-ui-checks`, `hisabiq-worker-d1-local-checks`, `hisabiq-react-preview-dist`. Hosted deploy and hosted acceptance jobs were **skipped**.

## Action coverage matrix

| Scenario | API/data provenance | Acceptance |
| --- | --- | --- |
| Signed-out and read-only access | `/api/auth/me`, Product role capabilities | PASS; no unauthorized write |
| Empty business and 503 catalog recovery | `GET /api/bootstrap` | PASS; no seed fallback, explicit Retry |
| Original table filters, columns, stock value | D1 bootstrap, not computed fake valuation | PASS across tested viewports |
| New basic stock product, opening FIFO lot | `POST /api/products` | PASS; exactly one submission |
| Duplicate barcode | 409 from server | PASS; explicit correction required |
| Catalog edit, concurrent stale revision | `PUT /api/products/:id/catalog` + `expectedUpdatedAt` | PASS; 409 preserves entered data; no stock overwrite |
| Ambiguous network/5xx product save | transport error | PASS; result shown as unknown, submit disabled until user reconciles |
| Signed positive and negative adjustment | `POST /api/products/:id/adjust-stock` | PASS; confirmed old/new quantity and reason, real FIFO + movement |
| Activate/deactivate | `PUT /api/products/:id/status` | PASS; real persistence |
| FIFO lots and audit history | `GET /api/products/:id/lots`, `GET /api/products/:id/history` | PASS; authentic lot and movement identifiers |
| Existing POS, serial, expiry, vendor, return | existing real Hono/Worker/D1 accounting | PASS; no regressions in recorded tests |

## Visual review findings

The implementer inspected saved 390/768/1024/1440 screenshot evidence in both themes. Responsive card hierarchy, tab underline, column chooser, row density, bilingual helper text and Mohim full-page editor match the pinned source layout composition. No document-wide horizontal overflow was detected. The narrowly focused POS keyboard issue `scrollable-region-focusable` was corrected by making its horizontal cart region a labelled, focusable region.

**Known tradeoff:** At 390px, the source-authentic compact Products table scrolls horizontally within its own panel; the final action column may require horizontal scrolling. This should receive independent low-literacy/user-observation review before wider rollout. No exact before/after pixel-diff of a separately captured unmodified source screenshot was produced; source JSX preservation is verified using pinned marker hashes plus visual inspection of the integrated output. Do not mistake this for an independently signed-off pixel-parity claim.

## Intentionally unavailable

Bundle product edit/posting, product import, Offers, dangerous Delete, Add Purchase Lot from Products, global Lots/History/Settings tabs, full multi-unit catalog edit, serial/expiry/warranty configuration remain disabled in this React slice, with the verified per-product FIFO Lots and History available through row Actions. These require separate safe end-to-end workflows.

## Release and rollback

**Release verdict: technical acceptance PASS; not approved for merge, preview deployment or production cutover.** PR #10 and its base PR #9 remain draft. Independent design and business review must approve source fidelity, mobile horizontal-table usability and remaining deferred controls before changing any hosted route.

If a later reviewed preview reveals a Products UI regression, switch only the generated primary `products` route back to the verified `LiveProductsPage` fallback in `scripts/prepare-hisabiq-react.mjs`, rebuild the isolated React assets and rerun tests. Do **not** reverse posted inventory, manually edit D1, merge draft branches, or deploy without separate authorization. Any future hosted preview needs a separate D1 backup/preflight and explicit approval.
