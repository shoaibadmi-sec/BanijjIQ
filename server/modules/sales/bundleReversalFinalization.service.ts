import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import { hasModulePermission } from '../auth/permissions.js';

type Body={clientRequestId?:unknown;reason?:unknown;[key:string]:unknown};
type Marker={invoice_id:string;request_id:string;payload_sha256:string;reason:string};
const error=(message:string,status=400)=>Response.json({ok:false,error:message},{status});

async function digest(input:unknown):Promise<string>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/**
 * Finalize an invoice ONLY when all approved returns already restored original FIFO
 * and every original cash payment was refunded. No new stock or money book rows.
 * SQL trigger performs the complete cash, sale-item and physical-source reconciliation
 * inside the same atomic transaction as the status change.
 */
export async function finalizeBundleInvoiceReversal(db:SherDatabase,invoiceId:string,body:Body,user:AuthUser):Promise<Response>{
 if(!(await hasModulePermission(db,user,'sales','edit')))
  return error('Sales edit permission is required to finalize an invoice reversal.',403);
 const requestId=body?.clientRequestId,reason=body?.reason;
 if(typeof invoiceId!=='string'||!invoiceId||
    typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)||
    typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500||
    !body||Object.keys(body).some(k=>!['clientRequestId','reason'].includes(k)))
  return error('Use unique finalization request ID, 8–500 character reason and no cash/stock overrides.');
 const fp=await digest({invoiceId,requestId,reason:reason.trim()});
 const prior=await db.prepare('SELECT invoice_id,request_id,payload_sha256,reason FROM bundle_invoice_finalizations WHERE request_id=? OR invoice_id=? LIMIT 1')
  .bind(requestId,invoiceId).first<Marker>();
 if(prior){
  if(prior.invoice_id!==invoiceId||prior.request_id!==requestId||prior.payload_sha256!==fp)
   return error('Invoice was already finalized or the request key was reused.',409);
  const invoice=await db.prepare('SELECT status FROM sales WHERE invoice_id=?').bind(invoiceId).first<{status:string}>();
  return invoice?.status==='Reversed'?
   Response.json({ok:true,replayed:true,invoiceId,status:'Reversed'}):
   error('Invoice finalization marker does not match the finalized invoice status.',409);
 }
 const invoice=await db.prepare('SELECT status FROM sales WHERE invoice_id=?').bind(invoiceId)
  .first<{status:string}>();
 if(!invoice)return error('Invoice not found.',404);
 if(invoice.status!=='Completed')return error('Only a completed, fully-refunded original cash invoice may be finalized.',409);
 const statements=[
  db.prepare('INSERT INTO bundle_invoice_finalizations(invoice_id,request_id,payload_sha256,reason,reversed_by) VALUES (?,?,?,?,?)')
   .bind(invoiceId,requestId,fp,reason.trim(),user.userId),
  db.prepare("UPDATE sales SET status='Reversed',updated_at=datetime('now') WHERE invoice_id=? AND status='Completed' AND is_deleted=0")
   .bind(invoiceId),
  db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'FINALIZE_BUNDLE_INVOICE_REVERSAL','SALE',?,?)")
   .bind(user.userId,invoiceId,'Already-refunded invoice finalized; no additional cash or stock posting. '+reason.trim())
 ];
 try{await db.batch(statements);}catch{
  const saved=await db.prepare('SELECT invoice_id,request_id,payload_sha256,reason FROM bundle_invoice_finalizations WHERE invoice_id=? OR request_id=? LIMIT 1')
   .bind(invoiceId,requestId).first<Marker>();
  if(saved&&saved.invoice_id===invoiceId&&saved.request_id===requestId&&saved.payload_sha256===fp){
   const current=await db.prepare('SELECT status FROM sales WHERE invoice_id=?').bind(invoiceId).first<{status:string}>();
   if(current?.status==='Reversed')return Response.json({ok:true,replayed:true,invoiceId,status:'Reversed'});
  }
  return error('Invoice reversal requires complete original cash and FIFO returns; no status or journal was changed.',409);
 }
 return Response.json({ok:true,replayed:false,invoiceId,status:'Reversed'});
}
