import type {SherDatabase,SqlPreparedStatement} from '../../db/types.js';
import type {AuthUser} from '../auth/types.js';

const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8'}});
const reject=(message:string,status=409)=>response({ok:false,error:message},status);
const clean=(v:unknown)=>String(v??'').trim();
const round4=(n:number)=>Math.round(n*10000)/10000;
type Refund={
 return_id:string;purchase_id:string;supplier_id:string;total_return_amount:number;
 refund_method:string;refund_status:string;refund_source_ledger_id:string;
 refund_bank_account_id:string;reversal_request_id:string;reversal_reason:string;
};
type Original={payment_method:string;payment_ledger_id:string;bank_account_id:string;
 paid_amount:number;returned_amount:number;status:string;supplier_id:string};
type Item={product_id:string;return_quantity:number;line_total:number};
type Movement={product_id:string;lot_id:string;quantity_in:number;quantity_out:number};
type Lot={lot_id:string;product_id:string;source_type:string;source_ref:string;
 original_quantity:number;remaining_quantity:number};
type MoneyRow={entry_id:string;type:string;reference:string;debit:number;credit:number;
 bank_account_id?:string;payment_method?:string};

export async function reversePaidPurchaseRefund(db:SherDatabase,returnId:string,
 input:{clientRequestId?:string;reason?:string},user:AuthUser):Promise<Response>{
 const requestId=clean(input.clientRequestId),reason=clean(input.reason);
 if(!/^[0-9a-f-]{32,36}$/i.test(requestId))return reject('A unique reversal request ID is required.',400);
 if(reason.length<4)return reject('Enter a clear reversal reason (at least four characters).',400);
 const original=await db.prepare('SELECT * FROM purchase_returns WHERE return_id=? AND COALESCE(is_deleted,0)=0')
   .bind(returnId).first<Refund>();
 if(!original)return reject('Purchase return not found.',404);
 if(!['Cash','Bank','Mobile Banking'].includes(original.refund_method))
   return reject('Only source-verified paid purchase refunds can be reversed.');
 if(original.refund_status==='Reversed')
   return original.reversal_request_id===requestId&&original.reversal_reason===reason
     ?response({ok:true,returnId,idempotent:true,reversed:true})
     :reject('This refund was already reversed with different request details.');
 if(original.refund_status!=='Posted')return reject('Refund is not in a reversible state.');
 const amount=Number(original.total_return_amount),method=original.refund_method;
 if(!Number.isFinite(amount)||amount<=0)return reject('Original refund amount is invalid.');
 const purchase=await db.prepare('SELECT payment_method,payment_ledger_id,bank_account_id,paid_amount,returned_amount,status,supplier_id FROM purchases WHERE purchase_id=? AND COALESCE(is_deleted,0)=0')
   .bind(original.purchase_id).first<Original>();
 if(!purchase||purchase.status!=='Completed'||purchase.supplier_id!==original.supplier_id||
   purchase.payment_method!==method||purchase.payment_ledger_id!==original.refund_source_ledger_id||
   clean(purchase.bank_account_id)!==clean(original.refund_bank_account_id)||
   Number(purchase.returned_amount)+0.0001<amount)
   return reject('Original paid purchase or returned amount changed. Reconcile first.');
 const due=await db.prepare('SELECT current_due FROM suppliers WHERE supplier_id=? AND status=? AND COALESCE(is_deleted,0)=0')
   .bind(original.supplier_id,'Active').first<{current_due:number}>();
 const ledgerDue=await db.prepare('SELECT COALESCE(SUM(debit-credit),0) AS due FROM supplier_ledger WHERE supplier_id=? AND COALESCE(is_deleted,0)=0')
   .bind(original.supplier_id).first<{due:number}>();
 if(!due||Math.abs(Number(due.current_due)-Number(ledgerDue?.due||0))>0.0001)
   return reject('Supplier payable is unreconciled.');
 const payment=await db.prepare('SELECT supplier_id,type,reference,debit,credit,payment_method,bank_account_id FROM supplier_ledger WHERE ledger_id=? AND COALESCE(is_deleted,0)=0')
   .bind(original.refund_source_ledger_id).first<any>();
 if(!payment||payment.supplier_id!==original.supplier_id||payment.type!=='Purchase Payment'||
   payment.reference!==original.purchase_id||Math.abs(Number(payment.debit))>0.0001||
   Math.abs(Number(payment.credit)-Number(purchase.paid_amount))>0.0001||
   payment.payment_method!==method||clean(payment.bank_account_id)!==clean(original.refund_bank_account_id))
   return reject('Original purchase payment ledger has changed.');
 const session=await db.prepare("SELECT session_id FROM cash_sessions WHERE status='Open' LIMIT 1").first();
 if(!session)return reject('Open a cash session before refund reversal.');
 const moneyTable=method==='Cash'?'cash_book':'bank_book';
 const readMoney=method==='Cash'
   ?'SELECT entry_id,type,reference,debit,credit,payment_method FROM cash_book WHERE reference=? AND COALESCE(is_deleted,0)=0'
   :'SELECT entry_id,type,reference,debit,credit,bank_account_id FROM bank_book WHERE reference=? AND COALESCE(is_deleted,0)=0';
 const refundRows=await db.prepare(readMoney).bind(returnId).all<MoneyRow>();
 const refund=refundRows.results[0];
 if(refundRows.results.length!==1||refund.type!=='Supplier Refund'||refund.reference!==returnId||
   Number(refund.debit)!==0||Math.abs(Number(refund.credit)-amount)>0.0001||
   (method==='Cash'&&refund.payment_method!=='Cash')||
   (method!=='Cash'&&refund.bank_account_id!==original.refund_bank_account_id))
   return reject('Original refund money-book entry is missing or altered.');
 const originalPaymentRows=await db.prepare(readMoney).bind(original.refund_source_ledger_id).all<MoneyRow>();
 const paid=originalPaymentRows.results[0];
 if(originalPaymentRows.results.length!==1||paid.type!=='Supplier Payment'||
   Number(paid.credit)!==0||Math.abs(Number(paid.debit)-Number(purchase.paid_amount))>0.0001||
   (method!=='Cash'&&paid.bank_account_id!==original.refund_bank_account_id))
   return reject('Original supplier payment book was altered.');
 let bankBalance=0;
 if(method!=='Cash'){
   const b=await db.prepare('SELECT current_balance FROM bank_accounts WHERE bank_account_id=? AND account_type=? AND status=?')
     .bind(original.refund_bank_account_id,method,'Active').first<{current_balance:number}>();
   const last=await db.prepare('SELECT balance FROM bank_book WHERE bank_account_id=? AND COALESCE(is_deleted,0)=0 ORDER BY created_at DESC,rowid DESC LIMIT 1')
     .bind(original.refund_bank_account_id).first<{balance:number}>();
   bankBalance=Number(b?.current_balance);
   if(!b||!last||!Number.isFinite(bankBalance)||bankBalance+0.0001<amount||
     Math.abs(bankBalance-Number(last.balance))>0.0001)
     return reject('Original bank/mobile account is insufficient or unreconciled.');
 }
 const lines=await db.prepare('SELECT product_id,return_quantity,line_total FROM purchase_return_items WHERE return_id=? AND purchase_id=?')
   .bind(returnId,original.purchase_id).all<Item>();
 const changes=await db.prepare("SELECT product_id,lot_id,quantity_in,quantity_out FROM stock_movements WHERE movement_type='Purchase Return' AND note=?")
   .bind(returnId).all<Movement>();
 if(!lines.results.length||!changes.results.length)return reject('Original FIFO return allocation is missing.');
 const requirements=new Map<string,number>(),restored=new Map<string,number>();
 let total=0;
 for(const line of lines.results){
   if(requirements.has(line.product_id)||Number(line.return_quantity)<=0)
     return reject('Duplicate or invalid original return line.');
   requirements.set(line.product_id,Number(line.return_quantity));
   total+=Number(line.line_total);
 }
 if(Math.abs(round4(total)-amount)>0.0001)return reject('Original refund amount no longer matches return lines.');
 const batch:SqlPreparedStatement[]=[];
 const today=new Date().toISOString().slice(0,10);
 for(const m of changes.results){
   if(!requirements.has(m.product_id)||!m.lot_id||Number(m.quantity_in)!==0||
     !Number.isFinite(Number(m.quantity_out))||Number(m.quantity_out)<=0)
     return reject('Original FIFO movement was altered.');
   const lot=await db.prepare('SELECT lot_id,product_id,source_type,source_ref,original_quantity,remaining_quantity FROM stock_lots WHERE lot_id=?')
     .bind(m.lot_id).first<Lot>();
   if(!lot||lot.product_id!==m.product_id||lot.source_type!=='PURCHASE'||
     lot.source_ref!==original.purchase_id||
     Number(lot.remaining_quantity)+Number(m.quantity_out)>Number(lot.original_quantity)+0.0001)
     return reject('Original purchase lot cannot safely restore returned stock.');
   restored.set(m.product_id,round4((restored.get(m.product_id)||0)+Number(m.quantity_out)));
   batch.push(db.prepare("UPDATE stock_lots SET remaining_quantity=remaining_quantity+?,status='Active',updated_at=datetime('now') WHERE lot_id=?")
     .bind(m.quantity_out,m.lot_id));
 }
 for(const [productId,quantity] of requirements){
   if(Math.abs(quantity-(restored.get(productId)||0))>0.0001)
     return reject('Return-item quantity and original FIFO movements disagree.');
   const product=await db.prepare('SELECT current_stock,track_serial,track_expiry FROM products WHERE product_id=? AND COALESCE(is_deleted,0)=0')
     .bind(productId).first<{current_stock:number;track_serial:number;track_expiry:number}>();
   if(!product||Number(product.track_serial)||Number(product.track_expiry))
     return reject('Tracked or unavailable products require a separate reversal.');
   const newStock=round4(Number(product.current_stock)+quantity);
   if(!Number.isFinite(newStock))return reject('Invalid stock quantity for refund reversal.');
   batch.push(db.prepare("UPDATE products SET current_stock=?,updated_at=datetime('now') WHERE product_id=?")
     .bind(newStock,productId));
   for(const m of changes.results.filter(m=>m.product_id===productId)){
     batch.push(db.prepare("INSERT INTO stock_movements (movement_id,product_id,movement_type,quantity_in,quantity_out,balance_after,lot_id,note,created_at) VALUES (?,?,'Purchase Return Reversal',?,0,?,?,?,datetime('now'))")
       .bind(crypto.randomUUID(),productId,m.quantity_out,newStock,m.lot_id,returnId));
   }
 }
 batch.unshift(db.prepare("UPDATE purchase_returns SET refund_status='Reversed',reversal_request_id=?,reversal_reason=?,reversed_by=?,reversed_at=datetime('now') WHERE return_id=? AND refund_status='Posted'")
   .bind(requestId,reason,user.userId,returnId));
 batch.push(db.prepare("UPDATE purchases SET returned_amount=returned_amount-?,updated_at=datetime('now') WHERE purchase_id=?")
   .bind(amount,original.purchase_id));
 if(method==='Cash'){
   batch.push(db.prepare("INSERT INTO cash_book (entry_id,date,type,reference,description,debit,credit,payment_method,created_at) VALUES (?,?,'Supplier Refund Reversal',?,?,?,0,'Cash',datetime('now'))")
     .bind(crypto.randomUUID(),today,returnId,'Reversed verified supplier refund',amount));
 }else{
   batch.push(db.prepare('UPDATE bank_accounts SET current_balance=current_balance-? WHERE bank_account_id=?')
     .bind(amount,original.refund_bank_account_id));
   batch.push(db.prepare("INSERT INTO bank_book (entry_id,bank_account_id,date,type,reference,description,debit,credit,bank_account_name,balance,created_by,reversal_of,created_at) VALUES (?,?,?,'Supplier Refund Reversal',?,?,?,0,(SELECT account_name FROM bank_accounts WHERE bank_account_id=?),(SELECT current_balance FROM bank_accounts WHERE bank_account_id=?),?,?,datetime('now'))")
     .bind(crypto.randomUUID(),original.refund_bank_account_id,today,returnId,
       'Reversed verified supplier refund',amount,original.refund_bank_account_id,
       original.refund_bank_account_id,user.userId,refund.entry_id));
 }
 batch.push(db.prepare("INSERT INTO audit_logs (user_id,action,entity_type,entity_id,note) VALUES (?,'REVERSE_PURCHASE_REFUND','PURCHASE_RETURN',?,?)")
   .bind(user.userId,returnId,reason));
 try{await db.batch(batch);}
 catch(e){
   const previous=await db.prepare('SELECT refund_status,reversal_request_id,reversal_reason FROM purchase_returns WHERE return_id=?')
     .bind(returnId).first<{refund_status:string;reversal_request_id:string;reversal_reason:string}>();
   if(previous?.refund_status==='Reversed')
     return previous.reversal_request_id===requestId&&previous.reversal_reason===reason
       ?response({ok:true,returnId,reversed:true,idempotent:true})
       :reject('Refund has already been reversed with different details.');
   if(/constraint|purchase_refund_reversal_|negative|changed|insufficient/i.test(String(e)))
     return reject('Refund source or stock changed. Reconcile before reversing.');
   throw e;
 }
 return response({ok:true,returnId,reversed:true,amount,originalRefundEntryId:refund.entry_id});
}
