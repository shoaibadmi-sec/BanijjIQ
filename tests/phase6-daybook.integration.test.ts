import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {getDayBookRoute} from '../server/modules/reporting/service.ts';

const auth={userId:'P6E-ADMIN',fullName:'Daybook Tester',role:'admin'} as any;
function fixture(){
 const db=new SqliteDatabase(':memory:');
 runMigrations(db.native,resolve('migrations'));
 db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES ('BK-SOURCE','Source Bank','Bank',100,100,'Active'),('BK-DEST','Destination Wallet','Mobile Banking',100,100,'Active')").run();
 const transfer=(id:string,txDate:string,created:string,amount=12)=>{
  db.native.prepare("INSERT INTO bank_transfers(transfer_id,transfer_date,from_account_id,from_account_name,to_account_id,to_account_name,amount,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
   .run(id,txDate,'BK-SOURCE','Source Bank','BK-DEST','Destination Wallet',amount,'Internal transfer','Daybook Tester',created);
  db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,debit,credit,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
   .run('OUT-'+id,'BK-SOURCE','Source Bank',txDate,'Transfer Out',id,amount,0,'Active',created);
  db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,bank_account_name,date,type,reference,debit,credit,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
   .run('IN-'+id,'BK-DEST','Destination Wallet',txDate,'Transfer In',id,0,amount,'Active',created);
 };
 const read=async(query:string)=>{
   const response=await getDayBookRoute(db,new URL('https://test.invalid/api/daybook?'+query),auth);
   return {status:response.status,...await response.json() as Record<string,any>};
 };
 return {db,transfer,read};
}
test('6E source-linked bank/mobile transfer appears once, with no fabricated income',async()=>{
 const f=fixture();
 try{
  f.transfer('BTR-ONE','2026-10-30','2026-10-30 12:00:00');
  const before=(f.db.native.prepare('SELECT total_changes() n').get() as any).n;
  const data=await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&page=1&pageSize=50');
  assert.equal(data.status,200,JSON.stringify(data));
  assert.equal(data.totalRows,1);
  assert.equal(data.rows.length,1);
  assert.equal(data.rows[0].module,'Bank Transfer');
  assert.equal(data.rows[0].sourceId,'BTR-ONE');
  assert.equal(data.rows[0].sourceModule,'Bank Transfer');
  assert.equal(data.rows[0].deleteAction,'');
  assert.equal(data.totals.cashIn+data.totals.cashOut+data.totals.bankIn+data.totals.bankOut,0,
    'internal movement is neither income nor expense');
  assert.equal((f.db.native.prepare('SELECT total_changes() n').get() as any).n,before,
    'Daybook GET must be strictly read-only');
 }finally{f.db.close();}
});
test('6E Daybook paginates 50/100 with a stable total and no duplicate source rows',async()=>{
 const f=fixture();
 try{
  for(let i=1;i<=52;i++)
   f.transfer('BTR-'+String(i).padStart(4,'0'),'2026-10-30','2026-10-30 12:00:00');
  const first=await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&page=1&pageSize=50');
  assert.equal(first.status,200);
  assert.equal(first.page,1);assert.equal(first.pageSize,50);assert.equal(first.totalRows,52);
  assert.equal(first.totalPages,2);assert.equal(first.rows.length,50);
  const second=await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&page=2&pageSize=50');
  assert.equal(second.rows.length,2);
  assert.equal(new Set([...first.rows,...second.rows].map((r:any)=>r.sourceId)).size,52);
  const hundred=await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&page=1&pageSize=100');
  assert.equal(hundred.rows.length,52);
  assert.equal((await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&pageSize=5')).status,400);
  assert.equal((await f.read('dateFrom=2026-10-31&dateTo=2026-10-30&pageSize=50')).status,400);
 }finally{f.db.close();}
});
test('6E transaction date and recorded-at ordering are distinct and deterministic',async()=>{
 const f=fixture();
 try{
  f.transfer('BTR-POSTED-LATE','2026-10-29','2026-10-30 10:00:00');
  f.transfer('BTR-POSTED-EARLY','2026-10-30','2026-10-29 11:00:00');
  const date=await f.read('dateFrom=2026-10-29&dateTo=2026-10-30&page=1&pageSize=50&sortBy=transactionDate');
  assert.equal(date.rows[0].sourceId,'BTR-POSTED-EARLY');
  const recorded=await f.read('dateFrom=2026-10-29&dateTo=2026-10-30&page=1&pageSize=50&sortBy=createdAt');
  assert.equal(recorded.rows[0].sourceId,'BTR-POSTED-LATE');
  assert.equal((await f.read('dateFrom=2026-10-29&dateTo=2026-10-30&pageSize=50&sortBy=random')).status,400);
 }finally{f.db.close();}
});
test('6E reversed bank transfer is preserved as reversed, not shown as a newly active payment',async()=>{
 const f=fixture();
 try{
  f.transfer('BTR-REVERSED','2026-10-30','2026-10-30 12:00:00');
  f.db.native.prepare("UPDATE bank_transfers SET reversed_at='2026-10-30 13:00:00',reversal_reason='Transfer corrected' WHERE transfer_id='BTR-REVERSED'").run();
  const data=await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&page=1&pageSize=50');
  assert.equal(data.rows.length,1);
  assert.equal(data.rows[0].status,'Reversed');
  assert.equal(data.totals.netBank,0);
 }finally{f.db.close();}
});
