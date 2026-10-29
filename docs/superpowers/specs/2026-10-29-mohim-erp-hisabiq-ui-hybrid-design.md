# Superpowers Design — Mohim ERP functionality in a clean HisabIQ_UI React interface

**Status:** FINALIZED PRODUCT/ARCHITECTURE DESIGN — the user explicitly approved the selected Mohim screen adaptation approach on 2026-10-29. Engineering implementation and any deployment are separate stages.
**Project:** HisabIQ React frontend + BanijjIQ Hono/Cloudflare Workers API + Cloudflare D1.
**Code location:** `shoaibadmi-sec/BanijjIQ`, **draft PR #9** / `feat/hisabiq-react-api`.
**Functional source:** `shuvodelux-commits/Mohim_ERP`, source revision `f95be8d9bcf55b08abe8841e7502d27b23c82c4c` (Google Apps Script and Google Sheets). Key references: `PROJECT.md`, `AGENTS.md`, actual `*.gs`/HTML modules and tests. Always cross-check code and test behavior; documents alone do not establish implemented behavior.
**Visual component source:** `shuvodelux-commits/hisabiq_ui`, pinned revision `9a8dc1ac4e85ac4e60f254e068bd67c2a805673f`, in BanijjIQ `apps/hisabiq-web` submodule.
**Existing deployment:** separately isolated React preview; existing `shererp-new` production Worker and production D1 remain untouched.

## 1. Product identity and user promise

This is **"Mohim ERP with HisabIQ's better UI/UX"**. The product is called **HisabIQ**; BanijjIQ names the Cloudflare backend. This is not a visually complete but mock-data HisabIQ_UI demo, not a redesign of every Mohim screen, and not an attempt to implement every speculative feature found in the HisabIQ_UI prototype.

Target user: Bangladeshi retail hardware/electrical shop staff, including low-literacy operators and cash-counter workers. Success means they can complete the full Mohim ERP business workflows in fewer, clearer steps while keeping full accounting and inventory traceability.

**Nonnegotiable product rule:** `Mohim_ERP` defines **what the ERP must do**; `hisabiq_ui` defines **how most of the ERP should look**. In the approved exceptions, use Mohim's workflow layout and interaction design, **but restyle it into HisabIQ components and tokens**, never render a separate blue/legacy HTML skin inside the React app.

### Goals
- Functional parity with the **verified** Mohim ERP release for core business modules, including complex exceptions/reversals, before advertising the migration as complete.
- Preserve proven HisabIQ dashboard, POS, compact Products table, combined Party ledger and shared ledger presentation.
- Use Mohim's practical Finance, Add/Edit Product, Product Actions and **complete Sales Management** workflows as layout/interaction sources, adapted to the cohesive HisabIQ visual system.
- Eliminate fabricated demo business data from every authenticated, operational route. An empty D1 shows an empty real business.
- Lower cognitive load: avoid extra screens, duplicate buttons, verbose cards and visual clutter; maintain rich drill-down access for advanced operations.

### Explicit non-goals
- Full feature parity with **all** HisabIQ_UI demo inventions or unfinished prototype workflows.
- Porting Apps Script to Cloudflare line-for-line, embedding its original HTML, or synchronizing Google Sheets at runtime.
- Rewriting the already-approved HisabIQ pages simply to accommodate a limited backend contract.
- Shipping new SaaS billing/multi-tenancy/security architecture under the pretext of parity with the current single-business Mohim workflow.
- Changing existing production routes, databases, tenant data, credentials or working preview without separate approval.

## 2. Approaches considered and decision

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Adopt the entire HisabIQ_UI demo app and build backend for every visible feature** | Fast visual reuse but uncontrolled scope and many complex features unrelated to the Mohim workflows | Reject |
| **B. Recreate Mohim screens in React and apply a generic HisabIQ theme** | Preserves workflow, but discards the dashboard, POS, combined Party ledger and tables explicitly preferred by the user | Reject |
| **C. Approved hybrid — HisabIQ_UI for most UI; selected Mohim workflows adapted to HisabIQ; Mohim business behavior throughout** | Requires careful module-by-module integration but minimizes design regressions and feature bloat | **Selected and approved** |

When the two sources disagree:
1. **Accounting, inventory, validations, permissions, workflow outcomes:** verify Mohim code/tests; implement semantically in Hono/D1. Preserve stronger already-verified Cloudflare idempotency/concurrency defenses.
2. **Look, spacing, navigation, general page shell and shared components:** follow original HisabIQ_UI.
3. **Finance, Add/Edit Product, Product Actions and entire Sales Management:** follow Mohim's action structure, affordances and operational order; present them in HisabIQ language and components.
4. **Explicit later user-approved capabilities** (e.g. specific unit-symbol UX, selected bundle rules) remain separately tracked extensions rather than being deleted or silently called part of Mohim parity.
5. If a new control is unavoidable to support a Mohim workflow, add it using the existing HisabIQ design system; do not copy Mohim's CSS styles directly.

## 3. Final UI / workflow source-of-truth matrix

| User-facing module/surface | Layout and visual reference | Functional/business reference | Critical preservation |
|---|---|---|---|
| **App shell, sidebar, top bar, global controls** | HisabIQ_UI shell, iconography, token system | Mohim navigation/permission policy | No duplicate tabs, clean responsive navigation; permission enforcement belongs server-side |
| **Dashboard** | HisabIQ_UI `src/pages/Dashboard.tsx` and widgets/charts | Mohim `Dashboard.gs`, `Reports.gs` | Actual D1 amounts, receivable/payable, profit, recent activity, low stock; only real trends |
| **POS and cart/checkout** | **HisabIQ_UI** `src/pages/Pos.tsx`, `CartTable`, `CheckoutPanel`, dialogs, multi-unit inline controls | Mohim `pos.html`, `posv2.html`, `Sales.gs`, `StockLots.gs`, `DraftSales.gs`, `Invoice.gs` | Original one-line item cart and keyboard flow, all Mohim posting logic; POS V2 is Mohim's workflow reference, not its color/layout skin |
| **Products directory / inventory table** | **HisabIQ_UI** `src/pages/Products.tsx`, table/filters/columns and inline layout | Mohim `Products.gs`, `StockLots.gs`, `ProductSettings.gs` | Current stock, stock value, price, status, filters and action access; no fallback demo records |
| **Add Product and Edit Product** | **Mohim `products.html` form structure**, adapted to HisabIQ React components and bilingual labels | Mohim `Products.gs`, `ProductSettings.gs`, `Bundles.gs` as applicable | Simple essential fields first, quick-add lookups, opening stock, pricing, optional deeper data without unnecessary visible clutter |
| **Product Actions** | **Mohim `products.html` workflow dialogs/actions**, styled like HisabIQ | Mohim stock adjustment, lot management, activation and product editing | Stock correction, value, lots, return dependencies, confirmations, audit; do not expose unsafe actions |
| **Combined Party directory and Party ledger** | **HisabIQ_UI** `src/pages/Parties.tsx`, `PartyDirectory*`, `PartyDetailAdaptive` and ledger tabs | Mohim `Customer.gs`, `Suppliers.gs`, `Vendors.gs`, `PartyLedger.gs`, settlement modules | One understandable person/workspace UX, role-specific balances and linked transaction history; preserve canonical records |
| **Every other ledger UI** | **HisabIQ_UI Party Ledger visual pattern** — underline tabs, compact rows, attachment/More icons, drill-down | Mohim Customer/Supplier/Vendor/Bank/Finance/Cash ledgers | Correct debit/credit and money-in/out semantics; chronological running balance; transaction linked to source |
| **Sales Management, Invoice actions, Drafts and all Returns** | **Mohim `sales.html`, `returns.html`, `returnHistory.html`, `draftSales.html`, related dialogs; adapted to HisabIQ design tokens** | Mohim `SalesManagement.gs`, `SalesReturn.gs`, `DraftSales.gs`, `Invoice.gs`, `DeleteEngine.gs` | Filters, invoice detail, edit/update, duplicate, draft continue, receive payment, print, multi-invoice return, safe return-price adjustment, reversal/deletion |
| **Finance, Finance People, Counter** | **Mohim `finance.html`, `financeLedger.html`, `financePersonLedger.html`, `counter.html`; compact HisabIQ styling** | Mohim `FinanceModule.gs`, `Counter.gs`, `CashSession.gs`, `CashReconciliation.gs`, `BankBook.gs` | Cash session, opening balance, person ledger, quick receive/pay, transfer, adjustment, reconciliation and amount-in-words |
| **Purchases / Supplier workflows** | HisabIQ overall shell, common inputs/tables; Mohim operational sequence for purchase entry/return | Mohim `Purchase.gs`, `PurchaseManagement.gs`, `PurchaseReturn.gs`, `SupplierSettlement.gs` | Lot-aware purchase, payment/due, history/edit, returns, supplier settlement; preserve linked ledger |
| **Vendor operations** | HisabIQ Party/ledger composition and compact action dialogs | Mohim `Vendors.gs` and consignment flows | Vendor-sourced sales, give/receive goods, vendor debts, traceable memos |
| **Daybook / Reports / Business Advisor-style views** | HisabIQ UI charts, Report Library patterns, details-on-click | Mohim `DayBook.gs`, `Reports.gs` | Only genuine D1 data; charts with correct source; no demo revenue or fabricated profit |
| **Settings / Users / Roles / invoice design** | HisabIQ settings and component system | Mohim `Settings.gs`, `RoleManagement.gs`, `UserManagement.gs` | Real persisted preferences, RBAC, invoice print settings, safer server-side enforcement |

**Selected Mohim surfaces are a deliberate design exception, not permission to use a second unthemed look.** Respect existing HisabIQ table typography, Geist + Hind Siliguri, Ink/Teal/Mint palette, compact row density, 36px ordinary controls and approximately 48px key workflow actions where applicable. Keep numeric text in proportional UI fonts (never monospace).

## 4. Usability contract (KISS, not reduced capability)

1. **Common action visible, exceptional action secondary.** The main 1–2 actions are immediately discoverable; edit/duplicate/refund/delete/adjust are in a contextual row menu, detail pane, or short labeled dialog.
2. **Information-rich but visually quiet.** Compact tables; meaningful columns; no overlarge cards, redundant helper paragraphs or repeated navigation layers. Use clear icons **with** understandable labels/tooltips where needed, not undecipherable icon-only controls for consequential actions.
3. **Single task location.** Example: Sales Management owns full invoice actions; POS is for creating/updating sales; combined Party workspace is for person overview/ledger; don't show separate competing live/demo surfaces in normal navigation.
4. **Bilingual guidance.** English primary + concise Bangla helper labels for users who need it; Bangla currency amount-in-words for cash transaction confirmation and receipts where applicable.
5. **No false simplicity.** Do not remove Mohim features or hide accounting differences. Keep advance/exceptions accessible within the same screen, not a second 'Basic ERP / Advanced ERP' interface.
6. **Responsive by layout content.** Use the original HisabIQ component-specific breakpoints, not a blanket 800px cutoff. Validate phone, narrow tablet, wide tablet and desktop. Keep POS cart product rows one line where the original design accommodates unit chains, with deliberate internal scroll/fit behavior instead of breaking the whole page.
7. **Keyboard/touch fast path.** POS focus loop: Add Product → select → Quantity → next line; predictable Enter, Escape and arrow keys; usable touch targets; visible focus; search with clear (x).
8. **Financial action confidence.** Confirmation dialogs show affected money, stock, due and cash/bank side before irreversible posts. Network ambiguity must never cause blind double submission.

## 5. Architectural integration

```text
HisabIQ_UI React components (majority)
  + select Mohim workflow layouts rebuilt with HisabIQ components
              │
    typed view models + async query/command adapters
              │ authenticated relative /api/*, authorization
BanijjIQ Hono Cloudflare Worker (business rules and transaction orchestration)
              │
       Cloudflare D1 (authoritative state)
```

- Continue the **pinned, clean** React submodule `apps/hisabiq-web` and disposable overlay build via `scripts/prepare-hisabiq-react.mjs`. Migration adapters should reuse source components; no app-wide visual reset. Source-ui updates should be reviewed as explicit pin updates.
- The current script replaces original POS and Products routes with `LivePosPage`/`LiveProductsPage`; this is the known UI divergence. Remove that replacement on a route-by-route basis **only after** the original-layout React screens pass their real-API contract and accounting tests. Preserve the existing working live pages as temporary explicitly labeled fallback, not as final designs.
- Do **not** directly hook the original seeded `data/salesPreviewStore.ts`, `data/partyPreviewStore.ts`, `data/erpDemoStore.ts` to real posting. Their synchronous preview commands are not validated atomic transactions. Provide typed async adapters and real server-sourced data; keep design previews in explicit opt-in dev routes only.
- Backend is authoritative for amounts, rounding, FIFO allocation, stock, dues, opening balances, returns, serial and expiry, permissions, snapshot versioning, vendor liabilities and audit. Port the Mohim behavior into Hono/D1 services or additive schema **only if existing API cannot already implement it**.
- Extend the existing backend's endpoints incrementally. A typical feature lifecycle: source code/test inventory → data shape/contract → D1 migration if needed → backend service and integration tests → React adapter → original UI wiring → browser tests.
- Use immutable canonical IDs and source provenance for sales/purchases/returns/people; do not merge Customer/Supplier/Vendor/Finance records by name or phone automatically without an approved identity model.
- Authenticated operational pages must never silently use local fixture stores on API failure. Display loading, retry, permission denied or empty state as appropriate, and prevent unauthorized writes.
- No direct bypass of server-side RBAC, cash-session guards, delete windows, soft-delete and full audit. Maintain effective operation date and creation timestamp separately when Mohim workflow requires it.

## 6. Mohim behavior that must not regress

The parity inventory is built from actual code and tests, not screenshots alone:

- **Inventory:** independent products; purchased stock lots carry supplier history; FIFO by purchase date then lot ID; stock adjustment and lot valuation; negative stock via explicit oversold source; vendor sourcing accounted separately from owned stock; original consumed lot restoration on return.
- **Sales:** complete Mohim POS behavior, cash session, pricing/discounts, duplicate/edit/return protections, real invoice numbers and receipt previews, phone-linked histories, draft invoice lifecycle, split/partial/due logic **to the extent implemented and verified in Mohim**.
- **Returns:** ordinary and customer-first multi-invoice selection, returnable quantity/price cap by original effective post-discount invoice price, per-source invoice accounting/refund allocation and repeated-return prevention.
- **People/ledgers:** customer receipts, supplier payments, vendor exchanges/memos, due adjustment, settlement discounts, opening balances and balance directions; full source links and audit.
- **Financial correctness:** cash and bank movement traceability, bank transfers, finance person balances and settlements, reversible actions with permission/backdate rules; active cash-session policy before applicable writes.
- **Integrity/security:** duplicate invoice ID fail-closed, unique ID generation, idempotency keys, checked affected records and locks, no partial posting, audit actor identity, server-side RBAC and delete protections.
- **Original visual capabilities accepted by the user:** in-cart unit-chain display with unit symbols and multi-unit support where required by the approved workflows; distinguish whether these are additions beyond the verified Mohim baseline and test each independently rather than claiming they are already Mohim features.
- **Bundle products:** confirmed Mohim source `Bundles.gs`, component sale and returns tests exist; retain single-line sale/print and per-component FIFO only when the D1 backend implementation passes the corresponding accounting tests.

For features present only in the HisabIQ_UI demo (e.g., speculative analytics, subscription controls, unsupported installments), **do not infer business availability from the mock interface**. Catalogue as a separate optional backlog unless an earlier explicit user-approved requirement applies.

## 7. Acceptance gates and increment order

### First: reference audit and parity matrix
- Build a **clickable-action inventory**: each Mohim action and validation → original Mohim source entrypoint and test → existing BanijjIQ endpoint/DB table → chosen HisabIQ/Mohim UI location → status (`verified live`, `needs adapter`, `needs backend`, `design only`).
- Record original source screenshots and component checks for **Dashboard, POS, Party ledger, Products table**. Record Mohim action/form behavior separately for **Finance, Add Product, Product Actions and full Sales Management**. Do not import all legacy CSS.
- Check operations with multi-record accounting effect **before** wiring UI. No simulated frontend success to hide missing D1 writes.

### Vertical slices (each must be functional and independently tested)
1. **Products:** original HisabIQ Products table + Mohim Add/Edit Product and Product Action flows, wired to real D1 and lot/stock operations. Existing working live Product creation must remain accessible until parity is proven.
2. **POS:** original HisabIQ cart/checkout + Mohim sale business rules. Verify cash, due, shortage, mixed-unit conversion, tracking, FIFO, receipts, idempotency and original keyboard/responsive UX before main-route cutover.
3. **Sales Management:** Mohim invoice list/detail/update/duplicate/drafts/returns workflow in HisabIQ styling; source-linked invoice and settlement accounting.
4. **Combined Parties and ledgers:** original HisabIQ Party workspace and ledger styling with real Customer/Supplier/Vendor source transactions and receive/pay actions.
5. **Finance and Counter:** Mohim finance structure with HisabIQ tokens, finance person ledger, cash/bank/reconciliation and amount-in-words.
6. **Purchases, Vendors and linked inventory:** preserve full Mohim purchase/return and vendor/source transactions with existing HisabIQ shell.
7. **Dashboard, Daybook, Reports, Settings and roles:** source-backed charts, real balances, report drill-down, UI control persistence and permissions; remove all business fixtures from live routes.
8. **Final cross-module parity audit:** cover not-yet-migrated functionality and negative/permission cases, including a clean D1, historical edits, returns, and full workflows through multiple modules.

A future Superpowers implementation plan should split these into **independently verifiable, small PR tasks**. If backend changes for one slice are large, split the domain contract first from the React adapter and browser cutover. Parallel UI and accounting changes cannot silently target a shared live database.

### Test and release requirements
- **Unit and SQL-level:** Node/TypeScript tests for input validation, debit/credit conservation, FIFO/oversold/vendor modes, stock lots, source references, cash session, permissions, atomic posting/reversal, and concurrent idempotency. Verify error responses and no-write-on-invalid requests.
- **D1 integration:** disposable database with real migrations; blank business → create product → purchase → sale → partial payment → return → customer/supplier ledger reconciliation → finance/cash/bank effects. Repeat request IDs must not duplicate accounting effects.
- **Browser E2E:** Playwright on desktop, tablet landscape and portrait, small phone; keyboard loops, search, form validation, empty states, multiple role permissions, error/retry, dark mode, print flows.
- **Visual review:** baseline against the **selected** UI source for each screen; compare title, layout, tab hierarchy, controls, table density, responsive behavior and readable typography. Visual changes to HisabIQ-authored screens require explicit approval. Adapted Mohim screens are checked for equivalent action availability and coherent HisabIQ style, not pixel-identical Mohim CSS.
- **Accessibility:** keyboard reach, discernible labels, visible focus, accessible dialog semantics and WCAG AA targets.
- **Performance:** avoid fetching all ledgers for every keystroke; server pagination/filtering for long tables; safe defaults and evidence-backed query improvements.
- **Release:** PR #9 stays draft, no automatic merge or production switch. Remote preview/preview D1 is also **not** changed without a separate user-approved deployment. The currently working live Product/POS routes and their data remain untouched until explicitly authorized; protect production Worker `shererp-new` and production D1.

## 8. Concrete code references and deliverables

**Mohim:** `AGENTS.md`, `PROJECT.md`, `products.html`, `sales.html`, `returns.html`, `draftSales.html`, `finance.html`, `financeLedger.html`, `financePersonLedger.html`, `counter.html`, `posv2.html`, `StockLots.gs`, `Sales.gs`, `SalesManagement.gs`, `SalesReturn.gs`, `Bundles.gs`, `DraftSales.gs`, `PartyLedger.gs`, `FinanceModule.gs`, `DeleteEngine.gs`, and tests (especially sale, FIFO, return, finance, bundle, permissions and browser regression).

**HisabIQ UI:** `src/pages/Dashboard.tsx`, `src/pages/Pos.tsx`, `src/pages/Products.tsx`, `src/pages/Parties.tsx`, `src/components/pos/*`, `src/components/parties/*`, `src/components/dashboard/*`, source global component and typography tokens.

**BanijjIQ:** `server/modules/*` service+route architecture, `migrations/*`, `react-integration/overlay/src/integration/*`, `scripts/prepare-hisabiq-react.mjs`, `react-integration/tests/*`, `d1-checks/*` and isolated hosted preview pipeline.

**Next Superpowers artifact:** `docs/superpowers/plans/2026-10-29-mohim-hisabiq-hybrid-implementation.md` should be written *after* this design is accepted as the engineering contract. Include task-level file paths, RED→GREEN tests, baseline/reference checks, worktree isolation, rollback and acceptance gates. No app implementation is implied by this spec commit.

## 9. Approval and change control

Recorded user approval: **"Approved: adapt Mohim Finance, Add Product, Product Actions and Sales Management screen layouts to HisabIQ branding, while preserving Mohim functionality."** The earlier user clarification also specifies **"most of the ui use hisabiq_ui"**.

This specification supersedes `docs/superpowers/specs/2026-10-29-hisabiq-ui-cloudflare-compatibility-design.md`, which overemphasized entire HisabIQ_UI demo parity and is not implementation authority. If a future engineer finds a dispute about the source of layout versus behavior, this hybrid module matrix is authoritative, and accounting correctness always takes precedence over a mocked UI state.

**This commit is documentation-only.** It does not prove that the application implements the specified workflows and does not authorize deployment or migration.
