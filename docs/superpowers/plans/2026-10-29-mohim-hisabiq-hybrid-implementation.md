# Mohim ERP × HisabIQ_UI — Products First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Engineering status:** PLANNED, NOT IMPLEMENTED. This is the FIRST INDEPENDENT VERTICAL SLICE (Products). Future modules receive separate plans after their preceding contract gates. Do not treat this as authorization to change hosted Cloudflare or production data.

**Goal:** Replace the temporary alternative Products layout with the **original HisabIQ_UI Products table**, plus **Mohim's simple Add/Edit Product and Product Actions workflows**, while all visible business state and supported writes are backed by real BanijjIQ/D1 and accounting safeguards.

**Architecture:** The original pinned HisabIQ React application supplies the shell and Products table, while a versioned integration adapter supplies typed API-backed data and asynchronous commands. Product forms/actions use Mohim workflows restyled into HisabIQ components. Business mutation and inventory accounting are authoritative in existing Hono services and isolated D1; the old `LiveProductsPage` stays on an explicit fallback URL until visual and accounting parity are proven.

**Tech Stack:** React 18 + TypeScript + Tailwind / existing HisabIQ source; Hono / TypeScript; Cloudflare Workers and D1; npm/Node ≥22, SQLite test adapter, Wrangler local D1, Playwright/Chromium, axe-core, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-29-mohim-erp-hisabiq-ui-hybrid-design.md` (approved design contract). Previous `2026-10-29-hisabiq-ui-cloudflare-compatibility-design.md` is superseded.

**Pinned references:**
- Mohim `shuvodelux-commits/Mohim_ERP` @ `f95be8d9bcf55b08abe8841e7502d27b23c82c4c`: `products.html`, `Products.gs`, `StockLots.gs`, `ProductSettings.gs`, `PROJECT.md`, `AGENTS.md`, financial/stock tests. Mohim defines workflow and semantics.
- HisabIQ `shuvodelux-commits/hisabiq_ui` @ `9a8dc1ac4e85ac4e60f254e068bd67c2a805673f`: `src/pages/Products.tsx`, `src/components/Table.tsx`, `src/components/products/*`, `src/types/erp.ts`. HisabIQ defines table composition, tabs, toolbar, rows, typography, responsive spacing and component language.
- BanijjIQ `shoaibadmi-sec/BanijjIQ`, draft PR #9 / branch `feat/hisabiq-react-api`. Existing tested API-backed `LiveProductsPage` and `LiveProductEditor` are **temporary fallback** only.

## Global Constraints

- Do not modify `shererp-new` production Worker or its D1 UUID `a94f21eb-bbd1-4ee8-8817-60726b547615`. Isolated hosted preview Worker `banijjiq-hisabiq-react-preview` and D1 UUID `9a122e4a-1d9d-43cd-b71e-062b6ed7758c` also stay unchanged unless the user separately approves a reviewed redeploy.
- Keep PR #9 DRAFT and unmerged. Implement/test on isolated branch or git worktree based on PR #9; commits must not inadvertently trigger production deployments. Review then integrate into the draft feature branch; no main merge without explicit authorization.
- Original `apps/hisabiq-web` pinned git submodule must remain clean. No broad visual rewrite, unreviewed SHA updates, or copy/paste of entire Mohim HTML screens into React.
- Every authenticated operational module displays **D1-derived** rows, counts and money. If API fails, show an error or retry; never silently revert to imported demo products/stock movements/offers. Explicit design-only routes may keep fixtures but must not write.
- All client actions carry real auth/RBAC; server enforces all permissions, cash-session policy where applicable, audit and input constraints. Stock additions/removals must be fully atomic with lot/movement/master-stock updates.
- Normal UI control height 36px, major workflow action approximately 48px when appropriate, Geist + Hind Siliguri, Ink/Teal/Mint theme, compact bilingual hints, **no monospace numeric values**, no fixed 800px responsive breakpoint.
- Scope FIRST PRODUCTS SLICE: real stock products, catalog edits, Mohim-style product actions and genuine lots/history. Bundle-component sale/return, multi-unit conversion, serial/expiry full workflows and offers require separately verified backend contracts. Show unavailable actions as disabled with reason rather than a fake/preview success.
- Choose idempotent/conditional writes and re-fetch persisted server results. Do not infer stock value from UI state; stock value must match server inventory valuation. Do not add a bulk import command before its atomic validation, duplication and rollback policies are verified.
- Use genuine test-fixture D1/SQLite and synthetic data. Never connect Playwright tests to production or the user's preview account.
- Each step is RED test → observe expected failure → minimal GREEN implementation → rerun exact test → commit; don't call any phase complete without fresh test output. Use `superpowers:verification-before-completion` at final gates.

## Review Focus — error cases to pin to tests

1. Two simultaneous product edits with same `expectedUpdatedAt` → only first wins; second returns 409; no stock/lot mutation (Task 3).
2. New product with duplicate barcode or invalid opening tracking metadata → HTTP 4xx and **zero** product, lookup, lot and movement rows left behind (Task 3).
3. Negative/NaN/too-large stock adjustment, stale product, tracked product stock-out → reject with no partial lot/master/ledger changes (Task 4).
4. New empty D1, network loss, restricted user, failed POST with ambiguous result → no demo rows, false success, unauthorized controls or automatic duplicate re-posting (Tasks 2, 5, 6).
5. 390/768/1024/1440px plus light/dark, Bangla helper, 4-digit/6-digit prices and table overflow → original HisabIQ table retains exact semantic hierarchy and accessible keyboard operation (Tasks 1, 6, 7).

---

## Source audit / file structure before coding

**Existing source layout to preserve:** `apps/hisabiq-web/src/pages/Products.tsx` (784 lines at pinned SHA), including `ProductColumnPicker`, `ProductActions`, `PageHeader`, four underline tabs, summary chips, search/category/stock filters and `Table` markup. Its business state currently comes from `availableProducts`, `availableStockLots`, `availableStockMovements`, preview imports and in-memory setters. The read-only baseline is also accessible from `#/app/products-design-preview` in the existing hosted preview (not a live data reference).

**Existing backend:** `GET /api/bootstrap` provides products, lookups, `stockValue`, sellable/pending/expired data. `POST /api/products` creates stock and opening lot, `PUT /api/products/:id/catalog` performs conditional catalog update, `POST /api/products/:id/adjust-stock` and `PUT /api/products/:id/status` exist, `GET /api/products/:id/lots` provides partial lot data. Contract limitations: original page actions can mutate browser-only data; lot history API is incomplete; `createProduct`/stock-adjust writes are not currently guaranteed as one atomic batch; a negative stock target can be normalized by `qty()` before rejection; status write may report success for a missing product. Fix/verify on a separate database before wiring actions.

**Target file responsibilities:**

| File (all paths relative to BanijjIQ) | Responsibility |
|---|---|
| `react-integration/overlay/src/integration/products/productContracts.ts` (new) | Pure typed API DTOs, domain-to-view mapping, product/lot valuation and unsupported-feature flags; no React or network |
| `react-integration/overlay/src/integration/products/productApi.ts` (new) | Authenticated async fetch/mutate methods; share `banijjApi.ts` request transport after making it safely exportable |
| `react-integration/overlay/src/integration/products/useLiveProducts.ts` (new) | Loading/refresh/error, mutation lock, permission-aware operations; async state not preview stores |
| `react-integration/overlay/src/integration/products/MohimProductEditor.tsx` (new) | Small, simple Mohim Add/Edit form flow rendered through existing HisabIQ Button/Input/Select, not second CSS framework |
| `react-integration/overlay/src/integration/products/MohimProductActions.tsx` (new) | Contextual product actions and safe confirmation; lot/history read-only detail or reviewed mutation |
| `scripts/prepare-hisabiq-react.mjs` (modify) and `scripts/preview/patch-live-products.mjs` (new) | Deterministic, strict-anchor changes only inside generated `.generated/hisabiq-web/src/pages/Products.tsx`: replace its **data source/action handlers** while preserving original table JSX, tab JSX, css classes and responsive components; fail build if source changed unexpectedly |
| `react-integration/overlay/src/integration/banijjApi.ts` (modify) | Expose shared typed network transport or narrowly share its implementation; retain existing auth semantics |
| `server/modules/products/service.ts` (modify) | Atomic create/adjust and true stock/lot valuation; existing endpoints remain backwards compatible |
| `server/modules/products/routes.ts` (modify) | Additional safe product history endpoint; authorization through existing server permission middleware |
| `server/modules/products/catalog.service.ts` (modify only if needed) | Conditional edit preserving price/stock revision and no ledger writes |
| `server/modules/auth/permissions.ts` (modify only if required) | Keep new mutation routes in 'products' authorization and correct operation classification |
| `tests/products-hybrid.integration.test.ts` (new) | Real-migration SQLite/Hono endpoint tests: empty source, product create/edit, adjustment, rollback, role restrictions, lots/history |
| `react-integration/tests/products-contract.test.ts` (new) | Unit tests for products typed adapters including empty/error/valuation and actions |
| `react-integration/tests/contract.test.mjs` (modify) | Replace old assertion expecting alternative Products route with assertion requiring original Products route |
| `ui-checks/products-hybrid.mjs` (new), `ui-checks/run.mjs` (modify) | Real original-layout reference snapshots, browser workflows, AA/keyboard, 390/768/1024/1440 light/dark; staged fake API is browser-only |
| `d1-checks/run.mjs` / `d1-checks/browser.mjs` (modify) | Real local Worker + isolated D1 + real React product test; no fake accounting |
| `docs/hisabiq-react-backend-migration.md` (modify) | New verified compatibility scope and known limitations |

Do not add speculative framework dependencies, a parallel Products SPA, or a replacement table. Existing source `Products.tsx` may require a **small target-specific data/controller seam**; implement it via a strict generated-copy patch, not by altering original submodule markup.

---

### Task 1: Confirm visual reference and immutable source boundaries

**Files:**
- Create: `react-integration/tests/products-source-parity.test.mjs`
- Test: `react-integration/tests/products-source-parity.test.mjs`
- Reference: pinned `apps/hisabiq-web/src/pages/Products.tsx`; Mohim `products.html`

**Interfaces:** Produces the frozen set of original Products JSX structure markers and screenshots the subsequent tasks compare against. Consumes no new runtime APIs.

- [ ] **Step 1: Write failing reference test.** Check that `react-integration/tests/reference/products-baseline.json` is present and records original `Products.tsx` SHA/markers (`PageHeader`, `MotionTabList`, `ProductColumnPicker`, stock-value `TableHead`, row `ProductActions`) with Mohim form/action list, but do not yet demand the future route cutover.
- [ ] **Step 2: Run RED.** `node --test react-integration/tests/products-source-parity.test.mjs` — expected FAIL because the reference manifest is not yet created.
- [ ] **Step 3: Freeze source revision and baseline checklist.** Create the referenced JSON with source marker hashes, source commit, original-table DOM/screenshot checklist, and mapping of original user actions to Mohim source actions; persist reproducible checks, not live business data. Include PageHeader, underline tabs, search/filter controls, table density, row More, stock value and Add form entry. Exclude fixture values from comparison. Defer route expectations until Task 6.
- [ ] **Step 4: Run GREEN.** `node --test react-integration/tests/products-source-parity.test.mjs` — expected PASS on the preserved reference manifest, with no requirement to switch the primary route now.
- [ ] **Step 5: Commit** `test(products): freeze HisabIQ table and Mohim action references`.

### Task 2: Real product DTOs, prices and empty-state adapters

**Files:**
- Create: `react-integration/overlay/src/integration/products/productContracts.ts`
- Create: `react-integration/overlay/src/integration/products/productApi.ts`
- Create: `react-integration/tests/products-contract.test.ts`
- Modify: `react-integration/overlay/src/integration/banijjApi.ts` (share typed request helper safely)
- Test: `react-integration/tests/products-contract.test.ts`

**Interfaces:** Produces:
- `type ProductCatalogResponse = {ok:true;products:BackendProduct[];categories:Lookup[];brands:Lookup[];units:Lookup[]}` (server may expose additional fields).
- `toProductView(row:BackendProduct): Product` (import `Product` from original `../../types/erp` in generated overlay).
- `loadProductCatalog():Promise<ProductCatalogResponse>`;
- `createProduct(payload:BasicProductInput):Promise<{ok:true;productId:string}>`;
- `editProduct(productId:string,payload:ProductCatalogEdit):Promise<{ok:true;productId:string}>`;
- `loadProductLots(productId:string):Promise<LiveLot[]>`.
- Product canonical IDs and `updatedAt` must remain available for conditional actions.

- [ ] **Step 1: Write RED tests.** `toProductView` mapping from D1 fields: `productId`→`id`, `productName`→`name`, `barcode`→`sku`, `currentStock`→`stock`, `minimumStock`→`minStock`, `sellingPrice`→`sellPrice`, `purchasePrice`→`purchasePrice`, status→`active`; preserve server `stockValue` separately so the table never invents it. Missing optional tracking values default to explicitly known false only. Empty catalog→[]/zero counters. Unit cost 0 is a valid lot cost; don't substitute default cost. Invalid 401/403/409/5xx display distinct application states; never load preview fixtures.
- [ ] **Step 2: Run RED.** `node --import tsx --test react-integration/tests/products-contract.test.ts` — expected FAIL: module missing.
- [ ] **Step 3: Implement pure mapping and API adapter.** Reuse `/api/bootstrap`, `/api/products`, `/api/products/:id/catalog`, `/api/products/:id/lots`; no duplicate auth token storage. Separate display stock from physical/sellable quantities where tracking is active; route 401 to outer auth gate and 403 to disabled/denied UI.
- [ ] **Step 4: Run GREEN.** Same command — expected PASS.
- [ ] **Step 5: Commit** `feat(products): add typed read/write D1 adapters and view-model mapping`.

### Task 3: Safeguard product create/edit database semantics

**Files:**
- Modify: `server/modules/products/service.ts`, `server/modules/products/catalog.service.ts` (only if concurrency tests reveal gaps)
- Test: `tests/products-hybrid.integration.test.ts`, existing `tests/product-catalog.integration.test.ts`

**Interfaces:** Existing `POST /api/products` and `PUT /api/products/:id/catalog` response shape stays compatible. Product create must be all-or-nothing with opening stock/lot/tracking/movements/lookups, or fail before writes. Catalog edit must require `expectedUpdatedAt` and NEVER mutate `current_stock` or lot history.

- [ ] **Step 1: Write RED integration tests** using `runMigrations(db.native, resolve('migrations'))` and `handleApiRequest(new Request(...), db)`. Assert valid create yields exactly one product, opening lot and movement; duplicate name/barcode yields no writes; deliberately invalid/duplicate serial/expiry tracking yields no partial product/lot/lookup rows; two stale edits on same version yield one 200 and one 409; edit of price leaves lots and stock unchanged. Verify no-op missing product yields 404.
- [ ] **Step 2: Run RED.** `node --import tsx --test tests/products-hybrid.integration.test.ts` — expected FAIL on invalid-tracking atomicity or missing guarantees, **not** on test syntax.
- [ ] **Step 3: Implement minimal atomic create**: fully validate names, monetary fields, quantity and tracking before mutation; collect Hono/D1 prepared product, lookup, opening-lot, tracking, stock-movement statements into one `db.batch` where compatible; rollback all on failure. Use safe ID generation/unique constraints. Retain `/api/products/:id/catalog` optimistic version check.
- [ ] **Step 4: Run GREEN plus regression.** `node --import tsx --test tests/products-hybrid.integration.test.ts tests/product-catalog.integration.test.ts tests/pos-accounting.integration.test.ts` — expected 0 failed; assert existing sale/FIFO tests stay green.
- [ ] **Step 5: Commit** `fix(products): enforce atomic stock product creation and immutable edit stock`.

### Task 4: Mohim Product Actions — safe adjustment, status and lot/history

**Files:**
- Modify: `server/modules/products/service.ts`, `server/modules/products/routes.ts`
- Modify only if needed: `server/modules/auth/permissions.ts`
- Test: `tests/products-hybrid.integration.test.ts`

**Interfaces:** Preserve:
- `POST /api/products/:id/adjust-stock` `{delta:number,note:string}`.
- `PUT /api/products/:id/status` `{status:'Active'|'Inactive'}`.
- `GET /api/products/:id/lots`.
- Add: `GET /api/products/:id/history`→`{ok:true,items:Array<{movementId:string,date:string,type:string,quantityIn:number,quantityOut:number,balanceAfter:number,note:string,lotId:string|null}>}`, sorted newest first, no fake history.

- [ ] **Step 1: RED tests.** Adjustment of +3 and −2 writes correct master quantity + lot allocation + one movement each; removing more than available returns 400, no negative stock, zero partial SQL changes. NaN/nonfinite/zero, stale product and tracked stock reduction fail; no-stock-status update returns 404; read-only role gets 403 on adjust/status. After sale/FIFO, history shows original source references, never synthetic movement IDs; lots show actual remaining quantity and unit cost.
- [ ] **Step 2: Run RED** on `node --import tsx --test tests/products-hybrid.integration.test.ts` — expected FAIL on stock-adjust negative normalization/missing history.
- [ ] **Step 3: Implement** reject-before-normalize quantity, plan removal in memory, enforce lot/master conservation and single atomic batch including movement and update, reject tracked reductions, validate unchanged product state before commit. Make status updates conditional (404 when no matching row) and preserve original status response for existing users. Add history route with proper `products:view` permission through existing middleware.
- [ ] **Step 4: Run GREEN**, same tests and `npm run backend:build` — both expected PASS.
- [ ] **Step 5: Commit** `fix(products): atomic Mohim stock actions and source-backed lot history`.

**Release scope protection:** Mohim's *separate lot-cost correction* and new explicit **purchase lot** entry have more complex accounting/reversal rules than quantity adjustment. Do **not** impersonate those actions with an adjustment POST. Leave them disabled and listed as a follow-up backend work package until their own cross-module tests are green.

### Task 5: Mohim-inspired Add/Edit and contextual Actions in HisabIQ components

**Files:**
- Create: `react-integration/overlay/src/integration/products/MohimProductEditor.tsx`
- Create: `react-integration/overlay/src/integration/products/MohimProductActions.tsx`
- Create: `react-integration/overlay/src/integration/products/useLiveProducts.ts`
- Modify: `react-integration/overlay/src/integration/products/productApi.ts`
- Test: `react-integration/tests/products-contract.test.ts` and `ui-checks/products-hybrid.mjs`

**Interfaces:** `useLiveProducts()` returns `{items,stockValueByProduct,loading,error,refresh,create,edit,adjustStock,setStatus,loadLots,loadHistory,pendingOperation}`. Each async write resolves only after an API confirmation and re-fetch; never updates a local preview store as if it posted. `MohimProductEditor({product,onCancel,onSaved})` and `MohimProductActions({product,capabilities,onChanged})` render using original HisabIQ components.

- [ ] **Step 1: RED contract tests**: Mohim required fields (English name, category, base unit, purchase and selling prices, opening stock, minimum stock, barcode optional); opening stock only at creation; editing rejects stock quantity change and concurrency conflicts; quick category/brand/unit selections from actual API. Product action menu exposes View, Edit, Adjust Stock, Lots, History, Activate/Deactivate when allowed. Non-integrated bundle, offers, add-stock-lot and dangerous delete actions are disabled with explicit concise reason; no accidental `upsertProductPreview`, `setList`, or `upsertBundlePreview`.
- [ ] **Step 2: Run RED:** `node --import tsx --test react-integration/tests/products-contract.test.ts` — expected FAIL on missing form/controller/action export.
- [ ] **Step 3: Implement** compact Mohim form flow in HisabIQ colors/field components with optional quick lookup add only if validated server create works. Use optimistic disable/pending, real errors, and before-unload unsaved-change confirmation; stock adjustment confirmation includes old+new quantities and reason; never reissue ambiguous POST automatically. If original AddProductDialog makes simple Mohim layout impractical, implement a focused Mohim-layout React form **inside original Products page** using existing components, not the old HTML skin.
- [ ] **Step 4: Run GREEN** contract tests. Add mock-browser assertions: opening form fields in expected order, escape/keyboard focus, 403 button gate, successful save triggers only one actual POST, pending button disabled, no demo action. 
- [ ] **Step 5: Commit** `feat(products): Mohim add/edit and contextual actions in HisabIQ style`.

### Task 6: Wire original HisabIQ Products table — not a replacement page

**Files:**
- Create: `scripts/preview/patch-live-products.mjs`
- Modify: `scripts/prepare-hisabiq-react.mjs`
- Modify: `react-integration/overlay/src/integration/products/useLiveProducts.ts`
- Modify: `react-integration/tests/contract.test.mjs`
- Test: `react-integration/tests/products-source-parity.test.mjs`, `ui-checks/products-hybrid.mjs`

**Interfaces:** `#/app/products` is the **original `Products` component**, integrated with `useLiveProducts()`, not `LiveProductsPage`. `#/app/live-products` is temporary fallback and `#/app/products-design-preview` can remain explicitly labeled design-only until cleanup. `#/app/pos` stays **unchanged** `LivePosPage` during this Products-only slice.

- [ ] **Step 1: RED tests** that build-time generated route `products` renders `<Products />` with API-backed list and **identical original JSX markers** for PageHeader, MotionTabList, categories, table header/cells, row actions, footers; no `availableProducts()`, `availableStockLots()`, `salesInvoices`, import-preview commit or other seed state can reach live products. Ensure `pos` still points to existing real POS. Original UI route should show blank D1 business state, not seed rows.
- [ ] **Step 2: Run RED:** `node --test react-integration/tests/products-source-parity.test.mjs react-integration/tests/contract.test.mjs` — expected FAIL on original route and preview seed usage.
- [ ] **Step 3: Implement narrow, strict build-copy patch.** Programmatic input: **exact source version**, strict expected anchors; fail if unsupported upstream changes. Target only source import block + data/controller calls + action handlers in generated `Products.tsx`; keep original table, tab, responsive grid and class names. Remove source demo-branch dependencies from operational path. Defer unsafe tabs/actions until real backing data exists; disabled label required. Update the old test that incorrectly demanded page replacement.
- [ ] **Step 4: Run GREEN** contract/source tests followed by `npm run react:build`. Inspect generated JSX or AST to verify original markup preserved and submodule `git status --porcelain` remains empty.
- [ ] **Step 5: Commit** `feat(products): connect original HisabIQ products table to Mohim D1 operations`.

### Task 7: Browser/real D1 acceptance and visual review (no hosted deployment)

**Files:**
- Create: `ui-checks/products-hybrid.mjs`
- Modify: `ui-checks/run.mjs`, `d1-checks/run.mjs`, `d1-checks/browser.mjs`
- Modify: `docs/hisabiq-react-backend-migration.md`
- Test: `tests/products-hybrid.integration.test.ts` + existing checks

**Interfaces:** produces `ui-checks/output` and `d1-checks/output` artifacts, a compact per-action coverage matrix and a clear pass/fail verdict. Existing POS functional tests remain green.

- [ ] **Step 1: RED Playwright tests** for signed-out gate, D1 empty list, server error (not demo fallback), Products table filters/columns, Mohim product create and catalog edit, adjustment/status, lots/history readback, admin vs read-only staff, duplicate barcode, 409 stale edit, ambiguous POST retry prevention and no duplicate posting. Capture baseline reference from pinned original design and integrated output; compare layout hierarchy/DOM properties and manual screenshot review.
- [ ] **Step 2: Run RED:** `node ui-checks/products-hybrid.mjs` (after `npm run react:build` and `npx playwright install chromium` from generated directory) — expected FAIL until API wiring/fixtures are complete; do not weaken tests to pass.
- [ ] **Step 3: Implement only test harness and real adapter corrections**. Inspect 390px mobile, 768px portrait tablet, 1024px landscape and 1440px desktop in light/dark. Product action controls follow HisabIQ compact table placement. Check small-device line wrapping, focus, labels, modal keyboard operation, icon visibility, numeric proportional font. Real-D1 browser uses same local Worker + migrated isolated D1 as `d1-checks/run.mjs`, not the hosted preview.
- [ ] **Step 4: Run GREEN and regression**:
  - `npm ci`
  - `node --import tsx --test tests/products-hybrid.integration.test.ts tests/product-catalog.integration.test.ts tests/pos-accounting.integration.test.ts react-integration/tests/products-contract.test.ts`
  - `node --test react-integration/tests/contract.test.mjs react-integration/tests/products-source-parity.test.mjs`
  - `npm run backend:build`
  - `npm run react:build`
  - `node ui-checks/run.mjs`
  - `node ui-checks/products-hybrid.mjs`
  - `node d1-checks/run.mjs`
  - `node d1-checks/phase12.mjs` and `node d1-checks/phase13-browser.mjs`
  Expected: every command exit code 0, screenshots saved, 0 critical axe violations, no unexpected 5xx/JS exception, no unauthorized or fake writes, zero production API calls.
- [ ] **Step 5: Freeze reference check and review.** An engineer/agent other than implementer checks visual before/after for original list plus Mohim action structure and marks `ready` only on screenshot + real-accounting pass; log remaining options as disabled intentionally with reasons and future-slice issue links. Provide a rollback: revert only generated main `products` route to existing `LiveProducts` fallback; do not revert database records or deploy.
- [ ] **Step 6: Commit** `test(products): verify original UI and Mohim D1 accounting end to end`.

---

## Integration / rollback gate — NOT a deployment step

All Tasks 1–7 must be verified before changing the primary Products route in any hosted environment. The generated build and new backend code must be fully tested on isolated local SQLite/Wrangler. **Do not deploy** to `banijjiq-hisabiq-react-preview` or touch its saved product/transaction data merely because this branch is green. Before any future preview deployment, explicitly present the new exact reviewed PR SHA, migration diff, preview D1 backup plan, screenshot comparisons, and a reversible route switch; wait for user approval.

The manually authorized hosted workflow checks exact PR #9 SHA, deploys ONLY its isolated Worker/D1, and may apply migrations; no automatic trigger after merging a doc. This plan requires reviewing that workflow's acceptance assertions when the Products primary route changes. Do not hardcode old selectors that require `LiveProductsPage`; update hosted read-only test to assert the original page's real data and its async-ready signal. Hosted preview deployment still requires separate authorization, and production cutover is a separate final project.

**Next independent plans after this Products slice:** original HisabIQ POS + verified Mohim sale workflow; full Mohim Sales Management; combined Party directory and source-linked ledgers; Mohim Finance/Counter; purchases/vendors; dashboard/daybook/reports/settings; comprehensive app parity. Those are **NOT implemented by this Products plan**.

## Completion criteria

- Original HisabIQ Products table, tabs, control density, search, filter and row action composition preserved; Mohim Add Product and actions fit the HisabIQ system.
- All visible operational product information is real D1 (and fetch failures cannot display sample businesses).
- Real product create and catalog edit, stock adjustments, status toggling and genuine lot/history are verified with SQL-side invariants and browser.
- Advanced Product features explicitly disabled unless their accounting-contract tests are green. Existing POS continues to work and its stock updates appear in Products.
- Tests run fresh and pass in the implementing session; independent visual review completed; PR #9 stays draft, preview/production unmodified.

**Execution handoff:** Review this plan against the approved hybrid spec. If acceptable, use `superpowers:executing-plans` or `superpowers:subagent-driven-development` starting with Task 1 and verified isolated worktree. No user question already answered needs to be asked again.
