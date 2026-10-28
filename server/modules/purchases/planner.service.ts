import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import type { PurchasePlanSaveInput, PurchasePlannerAnalysisInput, PurchasePlannerPriority } from './planner.types.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
function error(message: string, status = 400): Response { return json({ ok: false, error: message }, status); }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }
function wholeQty(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.round(n));
}
function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function round4(value: number): number { return Math.round(value * 10000) / 10000; }

export type PlannerRow = {
  productId: string;
  productName: string;
  displayName?: string;
  brand?: string;
  category: string;
  unit: string;
  barcode?: string;
  currentStock: number;
  reorderLevel: number;
  recentSalesQty: number;
  salesVelocity: number;
  stockCoverDays: number | null;
  pendingOrderQty: number;
  lastPurchaseCost: number;
  sellingPrice: number;
  preferredSupplierId: string;
  preferredSupplierName: string;
  lastSupplierId: string;
  lastSupplierName: string;
  supplierId: string;
  supplierName: string;
  priority: PurchasePlannerPriority;
  suggestedQty: number;
  plannedQty: number;
  plannedInvestment: number;
  expectedSalesValue: number;
  expectedGrossProfit: number;
  marginPercent: number;
  isNewProduct: boolean;
  included: boolean;
};

type RawPlannerRow = {
  productId: string;
  productName: string;
  displayName: string;
  brand: string;
  category: string;
  unit: string;
  barcode: string;
  currentStock: number;
  reorderLevel: number;
  purchasePrice: number;
  sellingPrice: number;
  recentSoldQty: number;
  recentReturnedQty: number;
  pendingOrderQty: number;
  preferredSupplierId: string;
  preferredSupplierName: string;
  lastSupplierId: string;
  lastSupplierName: string;
  lastPurchaseCost: number;
  lastPurchaseId: string;
};

function plannerParams(input: PurchasePlannerAnalysisInput) {
  const scope = input.scope === 'SUPPLIER' ? 'SUPPLIER' : 'ALL';
  const supplierId = cleanText(input.supplierId);
  const salesWindowDays = clampInt(input.salesWindowDays, 30, 7, 365);
  const targetCoverDays = clampInt(input.targetCoverDays, 30, 1, 365);
  const budgetAmount = money(input.budgetAmount);
  return { scope, supplierId, salesWindowDays, targetCoverDays, budgetAmount } as const;
}

function priorityRank(priority: PurchasePlannerPriority): number {
  return priority === 'Critical' ? 0 : priority === 'High' ? 1 : priority === 'Medium' ? 2 : 3;
}

function recalcMoney(row: PlannerRow): PlannerRow {
  const plannedQty = Math.max(0, Math.round(Number(row.plannedQty || 0)));
  const plannedInvestment = round4(plannedQty * Number(row.lastPurchaseCost || 0));
  const expectedSalesValue = round4(plannedQty * Number(row.sellingPrice || 0));
  const expectedGrossProfit = round4(expectedSalesValue - plannedInvestment);
  const marginPercent = expectedSalesValue > 0 ? round4((expectedGrossProfit / expectedSalesValue) * 100) : 0;
  return { ...row, plannedQty, plannedInvestment, expectedSalesValue, expectedGrossProfit, marginPercent };
}

function applyBudget(rows: PlannerRow[], budgetAmount: number): PlannerRow[] {
  if (budgetAmount <= 0) return rows.map((row) => recalcMoney({ ...row, plannedQty: row.suggestedQty }));
  let remaining = budgetAmount;
  const ordered = [...rows].sort((a, b) => {
    const rank = priorityRank(a.priority) - priorityRank(b.priority);
    if (rank) return rank;
    const aCover = a.stockCoverDays == null ? Number.POSITIVE_INFINITY : a.stockCoverDays;
    const bCover = b.stockCoverDays == null ? Number.POSITIVE_INFINITY : b.stockCoverDays;
    if (aCover !== bCover) return aCover - bCover;
    if (a.salesVelocity !== b.salesVelocity) return b.salesVelocity - a.salesVelocity;
    return a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' });
  });
  const plannedById = new Map<string, number>();
  for (const row of ordered) {
    if (row.suggestedQty <= 0 || row.lastPurchaseCost <= 0 || remaining < row.lastPurchaseCost) {
      plannedById.set(row.productId, 0);
      continue;
    }
    const affordable = Math.floor(remaining / row.lastPurchaseCost);
    const allocated = Math.max(0, Math.min(row.suggestedQty, affordable));
    plannedById.set(row.productId, allocated);
    remaining = round4(remaining - allocated * row.lastPurchaseCost);
  }
  return rows.map((row) => recalcMoney({ ...row, plannedQty: plannedById.get(row.productId) ?? 0 }));
}

export async function buildPlannerRows(db: SherDatabase, input: PurchasePlannerAnalysisInput): Promise<{ rows: PlannerRow[]; meta: ReturnType<typeof plannerParams> }> {
  const meta = plannerParams(input);
  if (meta.scope === 'SUPPLIER' && !meta.supplierId) throw new Error('Choose a supplier for supplier-wise planning.');
  const modifier = `-${meta.salesWindowDays - 1} days`;
  const result = await db.prepare(`
    WITH recent_sales AS (
      SELECT si.product_id, SUM(si.quantity) AS sold_qty
      FROM sale_items si
      INNER JOIN sales s ON s.invoice_id = si.invoice_id
      WHERE COALESCE(s.is_deleted, 0) = 0
        AND s.status = 'Completed'
        AND s.sale_date >= date('now', ?)
      GROUP BY si.product_id
    ),
    recent_returns AS (
      SELECT sri.product_id, SUM(sri.return_quantity) AS returned_qty
      FROM sales_return_items sri
      INNER JOIN sales_returns sr ON sr.return_id = sri.return_id
      WHERE sr.return_date >= date('now', ?)
      GROUP BY sri.product_id
    ),
    ranked_purchase AS (
      SELECT pi.product_id,
             pi.purchase_price,
             p.purchase_id,
             COALESCE(p.supplier_id, '') AS supplier_id,
             COALESCE(p.supplier_name, '') AS supplier_name,
             ROW_NUMBER() OVER (
               PARTITION BY pi.product_id
               ORDER BY p.purchase_date DESC, p.created_at DESC, pi.id DESC
             ) AS rn
      FROM purchase_items pi
      INNER JOIN purchases p ON p.purchase_id = pi.purchase_id
      WHERE COALESCE(p.is_deleted, 0) = 0 AND p.status = 'Completed'
    ),
    latest_purchase AS (
      SELECT product_id, purchase_price, purchase_id, supplier_id, supplier_name
      FROM ranked_purchase
      WHERE rn = 1
    ),
    pending_orders AS (
      SELECT poi.product_id, SUM(poi.quantity) AS pending_qty
      FROM purchase_plan_order_items poi
      INNER JOIN purchase_plan_orders po ON po.order_id = poi.order_id
      WHERE po.status = 'Open'
      GROUP BY poi.product_id
    )
    SELECT p.product_id AS productId,
           p.product_name AS productName,
           CASE WHEN TRIM(COALESCE(p.brand,'')) <> '' THEN TRIM(p.brand) || ' ' || p.product_name ELSE p.product_name END AS displayName,
           COALESCE(p.brand,'') AS brand,
           p.category,
           p.unit,
           COALESCE(p.barcode,'') AS barcode,
           COALESCE(p.current_stock, 0) AS currentStock,
           COALESCE(p.minimum_stock, 0) AS reorderLevel,
           COALESCE(p.purchase_price, 0) AS purchasePrice,
           COALESCE(p.selling_price, 0) AS sellingPrice,
           COALESCE(rs.sold_qty, 0) AS recentSoldQty,
           COALESCE(rr.returned_qty, 0) AS recentReturnedQty,
           COALESCE(po.pending_qty, 0) AS pendingOrderQty,
           COALESCE(ps.supplier_id, '') AS preferredSupplierId,
           COALESCE(ps.supplier_name, '') AS preferredSupplierName,
           COALESCE(lp.supplier_id, '') AS lastSupplierId,
           COALESCE(lp.supplier_name, '') AS lastSupplierName,
           COALESCE(lp.purchase_price, p.purchase_price, 0) AS lastPurchaseCost,
           COALESCE(lp.purchase_id, '') AS lastPurchaseId
    FROM products p
    LEFT JOIN recent_sales rs ON rs.product_id = p.product_id
    LEFT JOIN recent_returns rr ON rr.product_id = p.product_id
    LEFT JOIN latest_purchase lp ON lp.product_id = p.product_id
    LEFT JOIN pending_orders po ON po.product_id = p.product_id
    LEFT JOIN suppliers ps ON ps.supplier_id = p.preferred_supplier_id
      AND ps.status = 'Active' AND COALESCE(ps.is_deleted, 0) = 0
    WHERE p.is_deleted = 0
      AND p.status = 'Active'
      AND (
        ? = 'ALL'
        OR COALESCE(NULLIF(ps.supplier_id, ''), NULLIF(lp.supplier_id, ''), '') = ?
      )
    ORDER BY p.product_name COLLATE NOCASE ASC
  `).bind(modifier, modifier, meta.scope, meta.supplierId).all<RawPlannerRow>();

  let rows: PlannerRow[] = (result.results ?? []).map((raw) => {
    const recentSalesQty = Math.max(0, round4(Number(raw.recentSoldQty || 0) - Number(raw.recentReturnedQty || 0)));
    const velocity = recentSalesQty > 0 ? round4(recentSalesQty / meta.salesWindowDays) : 0;
    const currentStock = Math.max(0, Number(raw.currentStock || 0));
    const pendingOrderQty = Math.max(0, Number(raw.pendingOrderQty || 0));
    const effectiveStock = currentStock + pendingOrderQty;
    const reorderLevel = Math.max(0, Number(raw.reorderLevel || 0));
    const stockCoverDays = velocity > 0 ? round4(currentStock / velocity) : null;
    const targetStock = Math.max(reorderLevel, velocity > 0 ? Math.ceil(velocity * meta.targetCoverDays) : 0);
    const suggestedQty = Math.max(0, Math.ceil(targetStock - effectiveStock));
    const hasDemand = recentSalesQty > 0 || reorderLevel > 0;
    let priority: PurchasePlannerPriority = 'Low';
    if ((effectiveStock <= 0 && hasDemand) || (stockCoverDays != null && stockCoverDays <= 3)) priority = 'Critical';
    else if ((reorderLevel > 0 && effectiveStock <= reorderLevel) || (stockCoverDays != null && stockCoverDays <= 7)) priority = 'High';
    else if (suggestedQty > 0) priority = 'Medium';
    const supplierId = cleanText(raw.preferredSupplierId) || cleanText(raw.lastSupplierId);
    const supplierName = cleanText(raw.preferredSupplierName) || cleanText(raw.lastSupplierName);
    const lastPurchaseCost = Math.max(0, Number(raw.lastPurchaseCost || raw.purchasePrice || 0));
    return recalcMoney({
      productId: raw.productId,
      productName: raw.productName,
      displayName: raw.displayName,
      brand: raw.brand,
      category: raw.category,
      unit: raw.unit,
      barcode: raw.barcode,
      currentStock,
      reorderLevel,
      recentSalesQty,
      salesVelocity: velocity,
      stockCoverDays,
      pendingOrderQty,
      lastPurchaseCost,
      sellingPrice: Math.max(0, Number(raw.sellingPrice || 0)),
      preferredSupplierId: cleanText(raw.preferredSupplierId),
      preferredSupplierName: cleanText(raw.preferredSupplierName),
      lastSupplierId: cleanText(raw.lastSupplierId),
      lastSupplierName: cleanText(raw.lastSupplierName),
      supplierId,
      supplierName,
      priority,
      suggestedQty,
      plannedQty: suggestedQty,
      plannedInvestment: 0,
      expectedSalesValue: 0,
      expectedGrossProfit: 0,
      marginPercent: 0,
      isNewProduct: !cleanText(raw.lastPurchaseId) && recentSalesQty <= 0 && currentStock <= 0,
      included: suggestedQty > 0
    });
  });
  rows = applyBudget(rows, meta.budgetAmount);
  return { rows, meta };
}

function totals(rows: PlannerRow[]) {
  const included = rows.filter((r) => r.included && r.plannedQty > 0);
  const totalInvestment = round4(included.reduce((sum, row) => sum + row.plannedInvestment, 0));
  const expectedSalesValue = round4(included.reduce((sum, row) => sum + row.expectedSalesValue, 0));
  const expectedGrossProfit = round4(expectedSalesValue - totalInvestment);
  const marginPercent = expectedSalesValue > 0 ? round4((expectedGrossProfit / expectedSalesValue) * 100) : 0;
  return {
    totalInvestment,
    expectedSalesValue,
    expectedGrossProfit,
    marginPercent,
    criticalCount: rows.filter((r) => r.priority === 'Critical').length,
    highCount: rows.filter((r) => r.priority === 'High').length
  };
}

export async function analyzePurchasePlannerRoute(db: SherDatabase, input: PurchasePlannerAnalysisInput): Promise<Response> {
  try {
    const { rows, meta } = await buildPlannerRows(db, input);
    const suppliers = await db.prepare(`SELECT supplier_id AS id, supplier_name AS name FROM suppliers WHERE status='Active' AND COALESCE(is_deleted,0)=0 ORDER BY supplier_name COLLATE NOCASE`).all();
    return json({ ok: true, params: meta, rows, totals: totals(rows), suppliers: suppliers.results ?? [] });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Could not analyze purchase needs.');
  }
}

async function nextCode(db: SherDatabase, table: string, column: string, prefix: string): Promise<string> {
  const row = await db.prepare(`SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE ? ORDER BY CAST(SUBSTR(${column}, ?) AS INTEGER) DESC LIMIT 1`)
    .bind(`${prefix}-%`, prefix.length + 2).first<{ code: string }>();
  const last = row?.code ? Number(row.code.replace(`${prefix}-`, '')) : 0;
  return `${prefix}-${String(last + 1).padStart(6, '0')}`;
}

async function normalizeSavedRows(db: SherDatabase, input: PurchasePlanSaveInput): Promise<{ rows: PlannerRow[]; meta: ReturnType<typeof plannerParams> }> {
  const manual = Array.isArray(input.items) ? input.items : [];
  if (!manual.length) throw new Error('Add at least one product to the purchase plan.');
  const base = await buildPlannerRows(db, { ...input, scope: 'ALL' });
  const baseMap = new Map(base.rows.map((row) => [row.productId, row]));
  const supplierRows = await db.prepare(`SELECT supplier_id AS id, supplier_name AS name FROM suppliers WHERE status='Active' AND COALESCE(is_deleted,0)=0`).all<{ id: string; name: string }>();
  const suppliers = new Map((supplierRows.results ?? []).map((row) => [row.id, row.name]));
  const output: PlannerRow[] = [];
  const seen = new Set<string>();
  for (const item of manual) {
    const productId = cleanText(item.productId);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    const baseRow = baseMap.get(productId);
    if (!baseRow) continue;
    const overrideSupplierId = cleanText(item.supplierId);
    const supplierId = overrideSupplierId || baseRow.supplierId;
    const supplierName = supplierId ? (suppliers.get(supplierId) || '') : '';
    if (supplierId && !supplierName) throw new Error(`Supplier for ${baseRow.productName} is no longer active.`);
    const plannedQty = wholeQty(item.plannedQty);
    const included = item.included !== false;
    if (included && plannedQty > 0 && baseRow.lastPurchaseCost <= 0) {
      throw new Error(`Set a valid purchase price/cost for ${baseRow.productName} before saving the plan.`);
    }
    output.push(recalcMoney({
      ...baseRow,
      supplierId,
      supplierName,
      plannedQty,
      included
    }));
  }
  if (!output.some((row) => row.included && row.plannedQty > 0)) throw new Error('Enter a planned quantity for at least one product.');
  return { rows: output, meta: plannerParams(input) };
}

export async function savePurchasePlanRoute(db: SherDatabase, input: PurchasePlanSaveInput, user: AuthUser): Promise<Response> {
  let normalized: { rows: PlannerRow[]; meta: ReturnType<typeof plannerParams> };
  try { normalized = await normalizeSavedRows(db, input); }
  catch (err) { return error(err instanceof Error ? err.message : 'Could not save plan.'); }
  const planId = await nextCode(db, 'purchase_plans', 'plan_no', 'PPL');
  const planDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(input.planDate)) ? cleanText(input.planDate) : new Date().toISOString().slice(0, 10);
  const summary = totals(normalized.rows);
  const batch: SqlPreparedStatement[] = [
    db.prepare(`INSERT INTO purchase_plans (
      plan_id, plan_no, plan_date, scope, scope_supplier_id, sales_window_days, target_cover_days,
      budget_amount, status, total_investment, expected_sales_value, expected_gross_profit, margin_percent,
      notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
      .bind(planId, planId, planDate, normalized.meta.scope, normalized.meta.supplierId, normalized.meta.salesWindowDays,
        normalized.meta.targetCoverDays, normalized.meta.budgetAmount, summary.totalInvestment, summary.expectedSalesValue,
        summary.expectedGrossProfit, summary.marginPercent, cleanText(input.notes), user.userId)
  ];
  for (const row of normalized.rows) {
    batch.push(db.prepare(`INSERT INTO purchase_plan_items (
      plan_id, product_id, product_name, supplier_id, supplier_name, current_stock, reorder_level,
      recent_sales_qty, sales_velocity, stock_cover_days, pending_order_qty, last_purchase_cost, selling_price,
      priority, suggested_qty, planned_qty, planned_investment, expected_sales_value, expected_gross_profit,
      margin_percent, is_new_product, included, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .bind(planId, row.productId, row.productName, row.supplierId, row.supplierName, row.currentStock, row.reorderLevel,
        row.recentSalesQty, row.salesVelocity, row.stockCoverDays, row.pendingOrderQty, row.lastPurchaseCost, row.sellingPrice,
        row.priority, row.suggestedQty, row.plannedQty, row.plannedInvestment, row.expectedSalesValue,
        row.expectedGrossProfit, row.marginPercent, row.isNewProduct ? 1 : 0, row.included ? 1 : 0));
  }
  batch.push(db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'CREATE_PURCHASE_PLAN','PURCHASE_PLAN',?,?)`)
    .bind(user.userId, planId, `Planned investment ${summary.totalInvestment}`));
  await db.batch(batch);
  return json({ ok: true, planId, planNo: planId, totals: summary });
}

export async function updatePurchasePlanRoute(db: SherDatabase, planId: string, input: PurchasePlanSaveInput, user: AuthUser): Promise<Response> {
  const existing = await db.prepare(`SELECT plan_id AS planId, plan_no AS planNo, status FROM purchase_plans WHERE plan_id=?`).bind(planId).first<{ planId: string; planNo: string; status: string }>();
  if (!existing) return error('Purchase plan not found.', 404);
  if (existing.status !== 'Draft') return error('Only a Draft purchase plan can be updated.');

  let normalized: { rows: PlannerRow[]; meta: ReturnType<typeof plannerParams> };
  try { normalized = await normalizeSavedRows(db, input); }
  catch (err) { return error(err instanceof Error ? err.message : 'Could not update plan.'); }

  const planDate = /^\d{4}-\d{2}-\d{2}$/.test(cleanText(input.planDate)) ? cleanText(input.planDate) : new Date().toISOString().slice(0, 10);
  const summary = totals(normalized.rows);
  const batch: SqlPreparedStatement[] = [
    db.prepare(`UPDATE purchase_plans SET
      plan_date=?, scope=?, scope_supplier_id=?, sales_window_days=?, target_cover_days=?, budget_amount=?,
      total_investment=?, expected_sales_value=?, expected_gross_profit=?, margin_percent=?, notes=?, updated_at=datetime('now')
      WHERE plan_id=? AND status='Draft'`)
      .bind(planDate, normalized.meta.scope, normalized.meta.supplierId, normalized.meta.salesWindowDays,
        normalized.meta.targetCoverDays, normalized.meta.budgetAmount, summary.totalInvestment, summary.expectedSalesValue,
        summary.expectedGrossProfit, summary.marginPercent, cleanText(input.notes), planId),
    db.prepare(`DELETE FROM purchase_plan_items WHERE plan_id=?`).bind(planId)
  ];
  for (const row of normalized.rows) {
    batch.push(db.prepare(`INSERT INTO purchase_plan_items (
      plan_id, product_id, product_name, supplier_id, supplier_name, current_stock, reorder_level,
      recent_sales_qty, sales_velocity, stock_cover_days, pending_order_qty, last_purchase_cost, selling_price,
      priority, suggested_qty, planned_qty, planned_investment, expected_sales_value, expected_gross_profit,
      margin_percent, is_new_product, included, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .bind(planId, row.productId, row.productName, row.supplierId, row.supplierName, row.currentStock, row.reorderLevel,
        row.recentSalesQty, row.salesVelocity, row.stockCoverDays, row.pendingOrderQty, row.lastPurchaseCost, row.sellingPrice,
        row.priority, row.suggestedQty, row.plannedQty, row.plannedInvestment, row.expectedSalesValue,
        row.expectedGrossProfit, row.marginPercent, row.isNewProduct ? 1 : 0, row.included ? 1 : 0));
  }
  batch.push(db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'UPDATE_PURCHASE_PLAN','PURCHASE_PLAN',?,?)`)
    .bind(user.userId, planId, `Updated ${existing.planNo}; planned investment ${summary.totalInvestment}`));
  await db.batch(batch);
  return json({ ok: true, planId, planNo: existing.planNo, totals: summary });
}

export async function rejectPurchasePlanRoute(db: SherDatabase, planId: string, reason: string, user: AuthUser): Promise<Response> {
  const cleanReason = cleanText(reason);
  if (!cleanReason) return error('Enter a reason for rejecting this purchase plan.');
  const plan = await db.prepare(`SELECT plan_id AS planId, plan_no AS planNo, status FROM purchase_plans WHERE plan_id=?`).bind(planId).first<{ planId: string; planNo: string; status: string }>();
  if (!plan) return error('Purchase plan not found.', 404);
  if (!['Draft', 'Approved'].includes(plan.status)) {
    return error('Only a Draft or unconverted Approved purchase plan can be rejected.');
  }
  const converted = await db.prepare(`SELECT COUNT(*) AS n FROM purchase_plan_orders WHERE plan_id=? AND (status='Converted' OR COALESCE(converted_purchase_id,'')<>'')`).bind(planId).first<{ n: number }>();
  if (Number(converted?.n || 0) > 0) return error('This plan already has a converted Purchase and cannot be rejected.');

  const batch: SqlPreparedStatement[] = [];
  if (plan.status === 'Approved') {
    batch.push(db.prepare(`UPDATE purchase_plan_orders SET status='Cancelled', updated_at=datetime('now') WHERE plan_id=? AND status='Open'`).bind(planId));
  }
  batch.push(db.prepare(`UPDATE purchase_plans SET status='Rejected', rejected_at=datetime('now'), rejected_by=?, rejection_reason=?, updated_at=datetime('now') WHERE plan_id=?`)
    .bind(user.userId, cleanReason, planId));
  batch.push(db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'REJECT_PURCHASE_PLAN','PURCHASE_PLAN',?,?)`)
    .bind(user.userId, planId, cleanReason));
  await db.batch(batch);
  return json({ ok: true, planId, status: 'Rejected' });
}

export async function deletePurchasePlanRoute(db: SherDatabase, planId: string, reason: string, user: AuthUser): Promise<Response> {
  const cleanReason = cleanText(reason);
  if (!cleanReason) return error('Enter a reason for deleting this purchase plan.');
  const plan = await db.prepare(`SELECT plan_id AS planId, plan_no AS planNo, status FROM purchase_plans WHERE plan_id=?`).bind(planId).first<{ planId: string; planNo: string; status: string }>();
  if (!plan) return error('Purchase plan not found.', 404);
  if (!['Draft', 'Rejected'].includes(plan.status)) return error('Only Draft or Rejected purchase plans can be deleted. Reject an approved plan first.');

  const converted = await db.prepare(`SELECT COUNT(*) AS n FROM purchase_plan_orders WHERE plan_id=? AND (status='Converted' OR COALESCE(converted_purchase_id,'')<>'')`).bind(planId).first<{ n: number }>();
  if (Number(converted?.n || 0) > 0) return error('This plan is linked to an actual Purchase and cannot be deleted.');

  const batch: SqlPreparedStatement[] = [
    db.prepare(`DELETE FROM purchase_plan_order_items WHERE order_id IN (SELECT order_id FROM purchase_plan_orders WHERE plan_id=?)`).bind(planId),
    db.prepare(`DELETE FROM purchase_plan_orders WHERE plan_id=?`).bind(planId),
    db.prepare(`DELETE FROM purchase_plan_items WHERE plan_id=?`).bind(planId),
    db.prepare(`DELETE FROM purchase_plans WHERE plan_id=?`).bind(planId),
    db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'DELETE_PURCHASE_PLAN','PURCHASE_PLAN',?,?)`)
      .bind(user.userId, planId, `${plan.planNo}: ${cleanReason}`)
  ];
  await db.batch(batch);
  return json({ ok: true, planId });
}

export async function listPurchasePlansRoute(db: SherDatabase): Promise<Response> {
  const result = await db.prepare(`
    SELECT p.plan_id AS planId, p.plan_no AS planNo, p.plan_date AS planDate, p.scope,
           p.scope_supplier_id AS scopeSupplierId, p.sales_window_days AS salesWindowDays,
           p.target_cover_days AS targetCoverDays, p.budget_amount AS budgetAmount, p.status,
           p.total_investment AS totalInvestment, p.expected_sales_value AS expectedSalesValue,
           p.expected_gross_profit AS expectedGrossProfit, p.margin_percent AS marginPercent,
           p.notes, p.created_at AS createdAt, p.approved_at AS approvedAt, p.rejected_at AS rejectedAt,
           p.rejected_by AS rejectedBy, p.rejection_reason AS rejectionReason,
           COUNT(i.id) AS itemCount,
           SUM(CASE WHEN i.included=1 AND i.planned_qty>0 THEN i.planned_qty ELSE 0 END) AS totalQty
    FROM purchase_plans p
    LEFT JOIN purchase_plan_items i ON i.plan_id = p.plan_id
    GROUP BY p.plan_id
    ORDER BY p.plan_date DESC, p.created_at DESC
    LIMIT 200
  `).all();
  return json({ ok: true, plans: result.results ?? [] });
}

export async function getPurchasePlanRoute(db: SherDatabase, planId: string): Promise<Response> {
  const plan = await db.prepare(`SELECT plan_id AS planId, plan_no AS planNo, plan_date AS planDate, scope,
    scope_supplier_id AS scopeSupplierId, sales_window_days AS salesWindowDays, target_cover_days AS targetCoverDays,
    budget_amount AS budgetAmount, status, total_investment AS totalInvestment, expected_sales_value AS expectedSalesValue,
    expected_gross_profit AS expectedGrossProfit, margin_percent AS marginPercent, notes, created_at AS createdAt,
    approved_at AS approvedAt, rejected_at AS rejectedAt, rejected_by AS rejectedBy, rejection_reason AS rejectionReason
    FROM purchase_plans WHERE plan_id=?`).bind(planId).first();
  if (!plan) return error('Purchase plan not found.', 404);
  const items = await db.prepare(`SELECT id, product_id AS productId, product_name AS productName,
    '' AS category, '' AS unit, supplier_id AS supplierId, supplier_name AS supplierName,
    '' AS preferredSupplierId, '' AS preferredSupplierName, '' AS lastSupplierId, '' AS lastSupplierName,
    current_stock AS currentStock,
    reorder_level AS reorderLevel, recent_sales_qty AS recentSalesQty, sales_velocity AS salesVelocity,
    stock_cover_days AS stockCoverDays, pending_order_qty AS pendingOrderQty, last_purchase_cost AS lastPurchaseCost,
    selling_price AS sellingPrice, priority, suggested_qty AS suggestedQty, planned_qty AS plannedQty,
    planned_investment AS plannedInvestment, expected_sales_value AS expectedSalesValue,
    expected_gross_profit AS expectedGrossProfit, margin_percent AS marginPercent, is_new_product AS isNewProduct,
    included FROM purchase_plan_items WHERE plan_id=? ORDER BY supplier_name COLLATE NOCASE, product_name COLLATE NOCASE`).bind(planId).all();
  return json({ ok: true, plan, items: items.results ?? [] });
}

export async function approvePurchasePlanRoute(db: SherDatabase, planId: string, user: AuthUser): Promise<Response> {
  const plan = await db.prepare(`SELECT plan_id, status FROM purchase_plans WHERE plan_id=?`).bind(planId).first<{ plan_id: string; status: string }>();
  if (!plan) return error('Purchase plan not found.', 404);
  if (plan.status !== 'Draft') return error('Only a Draft purchase plan can be approved.');
  const items = await db.prepare(`SELECT product_id AS productId, product_name AS productName, supplier_id AS supplierId,
    supplier_name AS supplierName, planned_qty AS plannedQty FROM purchase_plan_items
    WHERE plan_id=? AND included=1 AND planned_qty>0 ORDER BY supplier_name COLLATE NOCASE, product_name COLLATE NOCASE`).bind(planId).all<any>();
  const rows = items.results ?? [];
  if (!rows.length) return error('This plan has no included quantities to approve.');
  const missing = rows.find((row: any) => !cleanText(row.supplierId));
  if (missing) return error(`Choose a supplier for ${missing.productName} before approval.`);
  const groups = new Map<string, { supplierName: string; items: any[] }>();
  for (const row of rows) {
    const key = cleanText(row.supplierId);
    if (!groups.has(key)) groups.set(key, { supplierName: cleanText(row.supplierName), items: [] });
    groups.get(key)!.items.push(row);
  }
  const batch: SqlPreparedStatement[] = [];
  const orders: Array<{ orderId: string; orderNo: string; supplierId: string; supplierName: string }> = [];
  const firstOrderCode = await nextCode(db, 'purchase_plan_orders', 'order_no', 'SPO');
  let nextOrderNumber = Number(firstOrderCode.replace('SPO-', ''));
  for (const [supplierId, group] of groups) {
    const orderId = `SPO-${String(nextOrderNumber).padStart(6, '0')}`;
    nextOrderNumber += 1;
    orders.push({ orderId, orderNo: orderId, supplierId, supplierName: group.supplierName });
    batch.push(db.prepare(`INSERT INTO purchase_plan_orders(order_id,order_no,plan_id,supplier_id,supplier_name,order_date,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,date('now'),'Open',?,datetime('now'),datetime('now'))`).bind(orderId, orderId, planId, supplierId, group.supplierName, user.userId));
    for (const item of group.items) {
      batch.push(db.prepare(`INSERT INTO purchase_plan_order_items(order_id,product_id,product_name,quantity,created_at)
        VALUES (?,?,?,?,datetime('now'))`).bind(orderId, item.productId, item.productName, wholeQty(item.plannedQty)));
    }
  }
  batch.push(db.prepare(`UPDATE purchase_plans SET status='Approved', approved_at=datetime('now'), updated_at=datetime('now') WHERE plan_id=?`).bind(planId));
  batch.push(db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'APPROVE_PURCHASE_PLAN','PURCHASE_PLAN',?,?)`)
    .bind(user.userId, planId, `Created ${orders.length} supplier purchase order(s)`));
  await db.batch(batch);
  return json({ ok: true, planId, orders });
}

export async function listPurchasePlanOrdersRoute(db: SherDatabase): Promise<Response> {
  const result = await db.prepare(`SELECT o.order_id AS orderId, o.order_no AS orderNo, o.plan_id AS planId,
    o.supplier_id AS supplierId, o.supplier_name AS supplierName, o.order_date AS orderDate, o.status,
    o.converted_purchase_id AS convertedPurchaseId, o.created_at AS createdAt,
    COUNT(i.id) AS itemCount, COALESCE(SUM(i.quantity),0) AS totalQty
    FROM purchase_plan_orders o LEFT JOIN purchase_plan_order_items i ON i.order_id=o.order_id
    GROUP BY o.order_id ORDER BY o.order_date DESC, o.created_at DESC LIMIT 300`).all();
  return json({ ok: true, orders: result.results ?? [] });
}

async function shopHeader(db: SherDatabase) {
  const keys = ['Shop Name','Shop Name Bangla','Shop Description','Address','Phone 1','Phone 2','Email','Invoice Logo'];
  const placeholders = keys.map(() => '?').join(',');
  const result = await db.prepare(`SELECT setting_key AS key, setting_value AS value FROM app_settings WHERE setting_key IN (${placeholders})`).bind(...keys).all<{ key: string; value: string }>();
  const map: Record<string,string> = {};
  for (const row of result.results ?? []) map[row.key] = row.value || '';
  return {
    shopName: map['Shop Name'] || 'SherERP',
    shopNameBangla: map['Shop Name Bangla'] || '',
    description: map['Shop Description'] || '',
    address: map['Address'] || '',
    phone1: map['Phone 1'] || '',
    phone2: map['Phone 2'] || '',
    email: map['Email'] || '',
    logo: map['Invoice Logo'] || ''
  };
}

export async function getPurchasePlanOrderRoute(db: SherDatabase, orderId: string): Promise<Response> {
  const order = await db.prepare(`SELECT order_id AS orderId, order_no AS orderNo, plan_id AS planId,
    supplier_id AS supplierId, supplier_name AS supplierName, order_date AS orderDate, status,
    converted_purchase_id AS convertedPurchaseId, created_at AS createdAt
    FROM purchase_plan_orders WHERE order_id=?`).bind(orderId).first();
  if (!order) return error('Supplier purchase order not found.', 404);
  const items = await db.prepare(`SELECT product_id AS productId, product_name AS productName, quantity
    FROM purchase_plan_order_items WHERE order_id=? ORDER BY id ASC`).bind(orderId).all();
  return json({ ok: true, order: { ...order, items: items.results ?? [], shop: await shopHeader(db) } });
}

export async function getPurchasePlanOrderConvertDataRoute(db: SherDatabase, orderId: string): Promise<Response> {
  const order = await db.prepare(`SELECT order_id AS orderId, order_no AS orderNo, plan_id AS planId,
    supplier_id AS supplierId, supplier_name AS supplierName, status, converted_purchase_id AS convertedPurchaseId
    FROM purchase_plan_orders WHERE order_id=?`).bind(orderId).first<any>();
  if (!order) return error('Supplier purchase order not found.', 404);
  if (order.status !== 'Open' || cleanText(order.convertedPurchaseId)) return error('This supplier order has already been converted or closed.');
  const items = await db.prepare(`
    SELECT oi.product_id AS productId, oi.product_name AS productName, oi.quantity,
           COALESCE(pi.last_purchase_cost, p.purchase_price, 0) AS unitPrice,
           COALESCE(p.selling_price, 0) AS sellingPrice
    FROM purchase_plan_order_items oi
    INNER JOIN purchase_plan_orders po ON po.order_id = oi.order_id
    LEFT JOIN purchase_plan_items pi ON pi.plan_id = po.plan_id AND pi.product_id = oi.product_id AND pi.supplier_id = po.supplier_id
    LEFT JOIN products p ON p.product_id = oi.product_id
    WHERE oi.order_id=?
    ORDER BY oi.id ASC
  `).bind(orderId).all();
  return json({ ok: true, purchase: {
    purchasePlanOrderId: order.orderId,
    orderNo: order.orderNo,
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    items: items.results ?? []
  }});
}
