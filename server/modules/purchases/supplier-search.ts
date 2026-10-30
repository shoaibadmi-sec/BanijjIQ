import type { SherDatabase } from '../../db/types.js';

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  currentDue: number;
  ledgerDue: number;
};

/** Purchase entry lookup: authenticated via the purchase VIEW permission in handler.ts.
 * This route never mutates supplier balances or opens a cash session.
 * The supplier master balance is the operational balance; a ledger discrepancy
 * is explicitly surfaced rather than hidden or silently corrected.
 */
export async function searchPurchaseSuppliersRoute(db: SherDatabase, rawQuery: string): Promise<Response> {
  const q = rawQuery.trim();
  if (q.length > 80) {
    return Response.json({ ok: false, error: 'Supplier search must be at most 80 characters.' }, { status: 400 });
  }
  const rows = await db.prepare(`
    SELECT s.supplier_id AS id, s.supplier_name AS name, s.phone AS phone,
           COALESCE(s.current_due,0) AS currentDue,
           COALESCE((
             SELECT SUM(COALESCE(l.debit,0)-COALESCE(l.credit,0))
             FROM supplier_ledger l
             WHERE l.supplier_id = s.supplier_id AND COALESCE(l.is_deleted,0)=0
           ),0) AS ledgerDue
    FROM suppliers s
    WHERE COALESCE(s.is_deleted,0)=0 AND s.status='Active'
      AND (?='' OR instr(lower(s.supplier_name),lower(?))>0
                 OR instr(COALESCE(s.phone,''),?)>0
                 OR instr(lower(s.supplier_id),lower(?))>0)
    ORDER BY CASE WHEN lower(s.supplier_name)=lower(?) THEN 0
                  WHEN instr(lower(s.supplier_name),lower(?))=1 THEN 1 ELSE 2 END,
             s.supplier_name COLLATE NOCASE, s.supplier_id
    LIMIT 30
  `).bind(q,q,q,q,q,q).all<SupplierRow>();
  const suppliers = (rows.results || []).map(s => {
    const currentDue = Number(s.currentDue);
    const ledgerDue = Number(s.ledgerDue);
    return {
      id: s.id, name: s.name, phone: s.phone || '',
      currentDue, ledgerDue,
      needsReconciliation: Math.abs(Math.round((currentDue-ledgerDue)*10000)) > 0
    };
  });
  return Response.json({ ok: true, suppliers });
}
