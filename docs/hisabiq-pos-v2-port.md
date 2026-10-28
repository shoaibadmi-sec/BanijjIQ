# HisabIQ POS V2 design port into BanijjIQ (Vue)

## Scope
- Source of visual/interaction reference: [HisabIQ_UI POS](https://github.com/shuvodelux-commits/hisabiq_ui/blob/main/src/pages/Pos.tsx), [CartTable](https://github.com/shuvodelux-commits/hisabiq_ui/blob/main/src/components/pos/CartTable.tsx), [CheckoutPanel](https://github.com/shuvodelux-commits/hisabiq_ui/blob/main/src/components/pos/CheckoutPanel.tsx), [ProductCombobox](https://github.com/shuvodelux-commits/hisabiq_ui/blob/main/src/components/pos/ProductCombobox.tsx).
- Design values sourced from HisabIQ_UI/theme.css and data/brand.ts: Ink #0B1A2C, Teal #0D7C74, Mint #3DD6B5, Canvas #F5F7FA, white surfaces.
- Target implementation: src/components/PosPanel.vue within BanijjIQ (Vue 3 / TypeScript).
- Base branch: feat/shererp-vue-visual-replacement. Other ERP modules remain under SherERP Vue styling. The PR is intentionally isolated and draft.

## Ported
- Cart-first, compact 6-column sale cart, inline product combobox with 12 visible ranked results, status and price; F2 search, Enter select and move focus to quantity, quantity Enter to search, F8 amount received.
- Quick items as selectable in-stock product suggestions.
- Separate checkout panel, customer lookup through existing name/phone datalist, previous due display, discount and paid amount.
- Teal payable area, due/change and full-width Complete Sale button.
- Source-like typography, Ink/Teal/Mint colors, responsive two-column desktop and stacked mobile/tablet.
- Existing cash session management, sale update, stock shortage modes, vendor cost/account controls, serial/expiry tracking, printing, JPG output and history retained.

## Deliberate compatibility boundaries
The HisabIQ source is React/Tailwind. BanijjIQ is Vue and currently has no Tailwind, shadcn-vue, Reka UI, TanStack Table or lucide-vue-next packages installed. This patch ports the UI design with locally scoped CSS; it does not copy React code into Vue or claim those packages are installed.
- Desired future UI stack: Vue 3 + TypeScript, Tailwind, shadcn-vue on Reka UI, Lucide Vue Next, TanStack Table Vue for complex record tables. Adopt via a separate dependency/lockfile and component migration PR; do not switch the entire production ERP's CSS or table logic with this POS change.
- Not implemented: HisabIQ multi-unit quantity conversion, bundle/component accounting, installments, split payment or templates/drafts. Existing BanijjIQ backend needs confirmed contracts and independent tests before those controls become enabled.
- No changes to server routes, migrations, database, API contracts, transaction payloads, print invoice or accounting rules.

## Acceptance criteria
- Vue TS and Vite build green; static contract tests green.
- Desktop: POS cart left, checkout right; tablet/phone: stacked cart before checkout.
- Search behaves on keyboard and touch; focus advances to quantity; no duplicate add.
- Existing POS update, customer dues, serial/expiry, vendor shortage, paid/due sale and invoice printing work.
- Browser review at 360, 390, 768, 1024 and 1440 px; no horizontal overflow outside cart table scroller.
- Confirm scanner barcode selects exact item; quantity input does not alter stock accounting.
- Review contrast, Bangla typography and bottom nav safe-area spacing.
- Keep draft/unmerged until visual and transactional testing. A green compiler build is not sufficient.
