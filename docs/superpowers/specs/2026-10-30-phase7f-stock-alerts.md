# Phase 7F1 — Inventory stock/expiry alerts (read-only)

## Boundary
- **Read-only API:** `GET /api/products/stock-alerts?asOf=YYYY-MM-DD&days=30&page=1&pageSize=50`.
- Uses existing Products.view permission (shared RBAC middleware) and **only** the tenant's current D1 binding.
- Returns `out-of-stock`, `low-stock`, `expired`, `expiring`, or `needs-review` alerts, source identifiers, and category counts.
- Product threshold means **at or below** minimum stock when stock is positive; zero stock is always out-of-stock.
- Expiry cutoff uses date-only UTC calendar comparisons: earlier than `asOf` is expired; equal or within `days` days is expiring.
- Includes only active undeleted products. Each active product's master stock must reconcile to its original-source FIFO lot balances before any actionable stock/expiry alert is emitted.
- Invalid/non-finite/more-than-four-decimal/overflow quantities, missing or overdrawn FIFO lots, missing/malformed expiry sources, and expiry allocation exceeding its lot **fail closed** to `needs-review`.
- `shortfallToMinimum` is an informational threshold gap, **not** an auto-generated purchase order or economic order quantity.
- Alerts sorted by source-review urgency and severity, then product/source keys. Returns total counts and 50/100 row pagination.
- No migrations, stock writes, accounting entries, alert scheduling, email, React design changes, or production deployment.

## Test-first / acceptance
1. **RED commit:** `225795a`, real authenticated route test returned 404 instead of required 200.
2. **GREEN:** `npm run test:phase7f` (business and migrated in-memory SQLite/API) and `npm run backend:build`.
3. Confirm the PR's exact-head CI and independent review before merging; the branch is DRAFT/HOLD until those gates complete.
4. Run existing Phase 3/4/5 accounting tests and React/Playwright/isolated Worker acceptance in the PR integration workflow.

## Deliberate follow-on
- Phase 7F2: React alert presentation and user-driven purchase-planner links, *only after approved UI requirements and live-source review*.
- Phase 7G: cross-phase inventory acceptance of open 7A–7E accounting and bundle dependencies.
