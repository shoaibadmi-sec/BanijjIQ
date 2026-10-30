# HisabIQ original frontend — backend API integration only

**Approved user rule (2026-10-30).** Existing HisabIQ React UI is the *only* frontend authority. This overrides earlier hybrid UI and Live*Page replacement proposals. The task is connecting original UI state/actions to backend, not inventing alternate screens.

## Mandatory sequence

1. Read the original pinned apps/hisabiq-web screen and inventory each visual control, action and demo data dependency.
2. Preserve exact JSX, shared components, CSS, visual behavior, animations, keyboard, touch, tablet layout and bilingual helpers.
3. Map reads/writes to existing BanijjIQ API with thin types, hooks and adapters; retain the original screen as the active route.
4. For missing operations, write backend failing tests first, verify RED, implement minimal authenticated/tenant-scoped Hono and D1 logic, verify GREEN, database transactions, exact poisha, FIFO/multi-unit/ledger/reversal as relevant.
5. Wire the tested endpoint into the existing frontend control; verify failures, permission gates and loading states without redesign.
6. Require original-vs-live source and screenshot parity, Playwright desktop/tablet/phone, a11y and real isolated Worker/D1 tests; independent review and exact-head GitHub CI before merge.

Never create replacement pages, new looks, alternate carts/tables, Vue ports or cosmetic tweaks. If an original UI feature/control does not exist, document the gap and obtain separate explicit UI approval. Never expose demo numbers as genuine financial data.

## Existing deviations (technical debt; NOT reusable patterns)

| Current integration | Original HisabIQ target | Required correction |
| --- | --- | --- |
| /app/pos routes to LivePosPage | Existing Pos / POS V2 | Wire the original cart/product search/payment controls to real POS API, keeping JSX |
| /app/products already uses source-verified patched Products | Existing Products | Keep the original table; finish backend state/action wiring |
| /app/purchases and /app/purchases/new route to LivePurchasesPage / LivePurchaseEditorPage | Existing Purchases / PurchaseEditor | Wire original purchase and supplier workflows to API |
| /app/reports routes to LiveReportsPage | Existing Reports and report components | Connect original charts/tables to verified reports API |
| LiveSalesReturnsPage is a separate integration route | Existing return workflow in HisabIQ UI | Integrate original return controls and shared POS cart |
| LiveBusinessSettingsPage and LiveTeamSettingsPage substitute Settings sections | Existing Settings components | Use existing screens and controls for tenant settings API |
| Dashboard and Party Ledger | Existing dashboard / combined Party Ledger | Audit and replace demo data/actions with real API + backend gaps |

Do not remove working Live* components or change routes before the original component is connected and full functionality is regression-tested. The old replacements cannot justify adding new replacements.

## Acceptance record for every screen

Record each original action → original component → typed API → authenticated backend handler → D1 transaction → ledger/stock/result → focused test. Clearly identify backend gaps. Require source-parity evidence, responsive screenshots, keyboard/mobile and dark mode checks. Full Worker/D1 CI and required reviews remain mandatory. Nothing here authorizes production deployment.
