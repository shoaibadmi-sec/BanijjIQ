# SherERP_Vue → BanijjIQ visual replacement

Source: https://github.com/shoaibadmi-sec/SherERP_Vue (main, 2026-10-28)
Target: https://github.com/shoaibadmi-sec/BanijjIQ

## Scope and safety
- Port the actual source frontend design tokens and shared component styles, **not** the repository-root `DESIGN.md` in isolation (its generic Dub references differ from the ERP UI).
- Preserve BanijjIQ's existing API, backend, routes, permissions, forms, accounting, data migrations, product and purchase state, and sales/returns workflow.
- Keep this work on a branch; no main-branch deployment until visual regression and business workflow tests succeed.
- The source lacks its referenced local font files; the copied token CSS uses the existing/system fallback. Do not require remote fonts for offline use.

## Target visual vocabulary
- Neutral page #f5f5f5, white cards, #e5e5e5 hairline borders.
- Blue #2563eb primary action, #dbeafe active navigation.
- 256px sidebar / 68px collapsed rail, main content left aligned.
- Shared 40px control height; compact 14px text, 8–12px gaps, 12px cards, 8px buttons.
- English-primary labels and secondary Bengali help text.
- Underlined secondary tabs, colored status badges, flat information-dense tables.
- Phone bottom navigation plus sidebar drawer.

## Implementation status
This branch installs the source's reusable CSS tokens and component primitives and adapts BanijjIQ's existing CSS classes, shell and tab components, and adds source-style phone navigation plus Ctrl+K module switching (module navigation only, not record search). This is an **initial cross-module visual migration, not a verified 1:1 copy of every screen**.

## Required validation before merge
1. Run `npm ci && npm run build`; resolve TypeScript/Vue build errors.
2. Screenshot at 360px, 390px, 768px, 1024px, 1280px, 1440px; test sidebar rail, drawer, bottom nav and toolbar wrapping.
3. Inspect all modules: Dashboard, POS, Sales/Returns, Customers, Products/Tracking, Purchases/Returns, Suppliers, Vendors, Finance/Bank/Daybook, Reports, Settings, Login, Admin.
4. Verify keyboard focus, modal stacks, table overflow, Bangla text, PDF/print, dark-mode contrasts before enabling a dark-mode switch.
5. Regression test data operations: invoice creation/edit/return, purchasing, FIFO/stock and tracking, ledgers, settings and authentication.
6. Replace old module-specific pixel overrides incrementally, then remove the compatibility layer; verify the source's design still renders correctly.
