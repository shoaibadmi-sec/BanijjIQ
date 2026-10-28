# SherERP Products + Inventory Refactor

This update extracts the Products/Inventory backend boundary from `server/core/handler.ts` without changing the public API contract.

## Extracted
- `/api/bootstrap`
- Product create/update/delete
- Product active/inactive status
- Manual stock adjustment
- Product lot history
- Category create/status
- Unit create/status
- Product ID generation
- Category/unit lookup creation
- Opening/manual stock lot + stock movement logic

## New files
- `server/modules/products/types.ts`
- `server/modules/products/service.ts`
- `server/modules/products/routes.ts`

## Shared behavior preserved
- Existing route paths and response shapes
- Existing SQLite/D1 SQL
- Existing product duplicate/barcode validation
- Existing opening stock behavior
- Existing stock movement and lot behavior
- Existing product delete rule
- Existing category/unit behavior
- Both Node+SQLite and Cloudflare+D1 database contract

## Intentionally not moved yet
Purchase/POS stock consumption remains in the current core until those modules are refactored. They import the shared `ProductRow` type from the Products module.

## Verification
- Shared server TypeScript compile: passed
- Frontend `src/` file changes: 0
- `server/core/handler.ts`: 3306 -> 2985 lines

This is a changed-files-only patch. Do not replace `wrangler.jsonc`, `data/shererp.sqlite`, or frontend files.
