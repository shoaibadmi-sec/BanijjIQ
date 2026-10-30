import type { SherDatabase } from '../../db/types.js';

/** Original HisabIQ Stock history table: real, read-only movement sources across products. */
export async function getInventoryHistoryRoute(db: SherDatabase): Promise<Response> {
  const rows=await db.prepare(`
    SELECT m.movement_id AS movementId,m.product_id AS productId,
      m.created_at AS date,m.movement_type AS type,
      m.quantity_in AS quantityIn,m.quantity_out AS quantityOut,
      m.balance_after AS balanceAfter,COALESCE(m.note,'') AS note,
      m.lot_id AS lotId
    FROM stock_movements m
    JOIN products p ON p.product_id=m.product_id
    WHERE COALESCE(p.is_deleted,0)=0
    ORDER BY m.created_at DESC,m.id DESC
  `).all();
  return new Response(JSON.stringify({ok:true,items:rows.results??[]}),{
    headers:{'content-type':'application/json; charset=utf-8'}
  });
}
