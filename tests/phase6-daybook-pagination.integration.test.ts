import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {getDayBookRoute} from '../server/modules/reporting/service.ts';

const actor={userId:'P6E-ADMIN',fullName:'Finance Tester',role:'admin'} as any;
function fixture(){
  const db=new SqliteDatabase(':memory:');
  runMigrations(db.native,resolve('migrations'));
  db.native.prepare("INSERT INTO finance_persons(person_id,person_name,person_type) VALUES('P6E-OWNER','Shop Owner','Owner')").run();
  const insert=(id:string,date:string,createdAt:string,amount=10.125)=>{
    db.native.prepare("INSERT INTO finance_transactions(finance_id,date,transaction_type,person_id,person_name,payment_method,amount,created_at) VALUES(?,?,'Owner Investment','P6E-OWNER','Shop Owner','Cash',?,?)").run(id,date,amount,createdAt);
  };
  const read=async(query:string)=>{
    const response=await getDayBookRoute(db,new URL('https://isolated.test/api/daybook?'+query),actor);
    return {status:response.status,...await response.json() as Record<string,any>};
  };
  return {db,insert,read};
}

test('6E Daybook returns stable nonoverlapping 50/100-page slices with full-range totals and no writes',async()=>{
  const f=fixture();
  try{
    for(let i=1;i<=52;i++)f.insert('FIN-E-'+String(i).padStart(3,'0'),'2026-10-30','2026-10-30 09:00:00');
    const query='dateFrom=2026-10-30&dateTo=2026-10-30&module=Finance&sortBy=transaction&pageSize=50';
    const before=(f.db.native.prepare('SELECT total_changes() n').get() as any).n;
    const first=await f.read(query+'&page=1');
    const second=await f.read(query+'&page=2');
    assert.equal(first.status,200);assert.equal(second.status,200);
    assert.equal(first.count,52);assert.equal(first.pagination.totalRows,52);
    assert.equal(first.pagination.totalPages,2);assert.equal(first.pagination.page,1);
    assert.equal(first.rows.length,50);assert.equal(second.rows.length,2);
    assert.equal(first.totals.cashIn,526.5);
    assert.equal(second.totals.cashIn,526.5,'pagination never truncates accounting totals');
    const ids=[...first.rows,...second.rows].map((r:any)=>r.sourceId);
    assert.equal(new Set(ids).size,52,'no duplicate/missing Daybook entries across page boundaries');
    assert.deepEqual((await f.read(query+'&page=1')).rows.map((r:any)=>r.sourceId),
      first.rows.map((r:any)=>r.sourceId),'ties must be ordered deterministically');
    const hundred=await f.read(query.replace('pageSize=50','pageSize=100')+'&page=1');
    assert.equal(hundred.rows.length,52);
    assert.equal((f.db.native.prepare('SELECT total_changes() n').get() as any).n,before,
      'read-only Daybook cannot mutate source books');
  }finally{f.db.close();}
});

test('6E Daybook date order uses transaction date; creation order remains independently selectable',async()=>{
  const f=fixture();
  try{
    f.insert('FIN-E-OLD','2026-10-24','2026-10-30 11:00:00');
    f.insert('FIN-E-NEW','2026-10-30','2026-10-29 09:00:00');
    const base='dateFrom=2026-10-24&dateTo=2026-10-30&module=Finance&pageSize=50&page=1';
    const transaction=await f.read(base+'&sortBy=transaction');
    const created=await f.read(base+'&sortBy=created');
    assert.deepEqual(transaction.rows.map((r:any)=>r.referenceNo),['FIN-E-NEW','FIN-E-OLD']);
    assert.deepEqual(created.rows.map((r:any)=>r.referenceNo),['FIN-E-OLD','FIN-E-NEW']);
    assert.equal(transaction.rows[1].date,'2026-10-24','backdated entry preserves original date');
    assert.equal(transaction.rows[1].sourceModule,'Finance');
  }finally{f.db.close();}
});

test('6E rejects malformed paging/sort inputs rather than silently returning an unbounded feed',async()=>{
  const f=fixture();
  try{
    for(const bad of ['page=0','page=1.5','page=abc','pageSize=200','pageSize=0','sortBy=untrusted']){
      const result=await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&module=Finance&'+bad);
      assert.equal(result.status,400,bad);
    }
    const legacy=await f.read('dateFrom=2026-10-30&dateTo=2026-10-30&module=Finance');
    assert.equal(legacy.status,200,'existing dashboard and Vue callers must remain compatible');
  }finally{f.db.close();}
});
