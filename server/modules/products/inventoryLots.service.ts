import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { getUserPermissions } from '../auth/permissions.js';

type LotRow={
  lotId:string;productId:string;sourceType:string;sourceRef:string|null;receivedAt:string;
  originalQuantity:number;remainingQuantity:number;unitCost:number;
  trackExpiry:number;trackSerial:number;trackingPending:number;trackingStatus:string;
};
type ExpiryRow={lotId:string;batchNumber:string;expiryDate:string;remainingQuantity:number};
type SerialRow={lotId:string;serialNumber:string};

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}});
}
function saneQuantity(v:unknown):v is number{
  return typeof v==='number'&&Number.isFinite(v)&&v>=0&&
    Number.isSafeInteger(Math.round(v*10000))&&Math.abs(v*10000-Math.round(v*10000))<0.00001;
}
const round=(v:number)=>Math.round(v*10000);

/** Read-only, cost-protected source for the exact original HisabIQ StockLotsView. */
export async function getInventoryLotsRoute(db:SherDatabase,user:AuthUser):Promise<Response>{
  const permissions=await getUserPermissions(db,user);
  if(permissions!==null&&!(
    permissions.products?.edit||permissions.purchase?.view||permissions.posCost?.view
  )) return json({ok:false,error:'Purchase-cost permission is required to view stock lots.'},403);

  const [lr,er,sr]=await Promise.all([
    db.prepare(`SELECT l.lot_id AS lotId,l.product_id AS productId,l.source_type AS sourceType,
      l.source_ref AS sourceRef,l.created_at AS receivedAt,
      l.original_quantity AS originalQuantity,l.remaining_quantity AS remainingQuantity,
      l.unit_cost AS unitCost,l.tracking_required_quantity AS trackingPending,
      l.tracking_status AS trackingStatus,
      p.track_expiry AS trackExpiry,p.track_serial AS trackSerial
      FROM stock_lots l JOIN products p ON p.product_id=l.product_id
      WHERE COALESCE(p.is_deleted,0)=0
      ORDER BY l.created_at DESC,l.id DESC`).all<LotRow>(),
    db.prepare(`SELECT lot_id AS lotId,batch_no AS batchNumber,expiry_date AS expiryDate,
      remaining_quantity AS remainingQuantity
      FROM stock_expiry_batches WHERE remaining_quantity>0`).all<ExpiryRow>(),
    db.prepare(`SELECT lot_id AS lotId,serial_number AS serialNumber
      FROM product_serials WHERE status='In Stock'`).all<SerialRow>()
  ]);
  const expiries=new Map<string,ExpiryRow[]>();
  const serials=new Map<string,string[]>();
  for(const row of er.results??[]){
    if(!expiries.has(row.lotId))expiries.set(row.lotId,[]);
    expiries.get(row.lotId)!.push(row);
  }
  for(const row of sr.results??[]){
    if(!serials.has(row.lotId))serials.set(row.lotId,[]);
    serials.get(row.lotId)!.push(row.serialNumber);
  }
  const lots=[];
  for(const row of lr.results??[]){
    if(!saneQuantity(row.originalQuantity)||!saneQuantity(row.remainingQuantity)||
        !saneQuantity(row.unitCost)||!saneQuantity(row.trackingPending)||
        round(row.remainingQuantity)>round(row.originalQuantity)||
        !row.lotId||!row.productId)
      return json({ok:false,error:'Stock lot source cannot be reconciled.'},409);
    const batches=expiries.get(row.lotId)??[];
    const assigned=batches.reduce((sum,b)=>sum+round(b.remainingQuantity),0);
    if(batches.some(b=>!saneQuantity(b.remainingQuantity))||row.trackingPending>0||
        (row.trackExpiry&&row.remainingQuantity>0&&
          (batches.length!==1||assigned!==round(row.remainingQuantity)))||
        (!row.trackExpiry&&batches.length))
      return json({ok:false,error:'Expiry tracking for stock lots is incomplete or ambiguous.'},409);
    const batch=batches[0];
    lots.push({
      lotId:row.lotId,productId:row.productId,sourceType:row.sourceType,
      sourceRef:row.sourceRef,receivedAt:row.receivedAt,
      originalQuantity:row.originalQuantity,remainingQuantity:row.remainingQuantity,
      unitCost:row.unitCost,batchNumber:batch?.batchNumber??null,
      expiryDate:batch?.expiryDate??null,serials:serials.get(row.lotId)??[]
    });
  }
  return json({ok:true,lots});
}
