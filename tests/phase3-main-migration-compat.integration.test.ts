import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

const allFiles=readdirSync(resolve('migrations')).filter(name=>/^\d+.*\.sql$/i.test(name)).sort();
const phase3Files=new Set([
  '0039_store_credit_liability.sql','0040_store_credit_issue_guard.sql',
  '0041_store_credit_redemption.sql','0043_store_credit_cases.sql',
  '0044_store_credit_historical_adjustments.sql','0045_sale_tender_allocations.sql',
  '0046_split_tender_posting_guard.sql','0047_split_sale_source_refunds.sql',
  '0048_split_partial_source_budget.sql','0049_split_partial_fifo_provenance.sql',
  '0050_split_partial_refund_final_audit.sql','0051_split_partial_credit_reissue_guard.sql'
]);
const purchaseFiles=new Set([
  '0050_purchase_unit_snapshots.sql','0051_mixed_purchase_return_allocations.sql',
  '0052_supplier_settlement_entries.sql','0053_order_conversion_guard.sql',
  '0054_paid_purchase_atomic_preflight.sql','0055_purchase_return_supplier_credit_guard.sql',
  '0056_paid_purchase_refund_receipts.sql','0057_purchase_refund_reversals.sql',
  '0058_purchase_refund_original_cash_guard.sql'
]);
const assertEqualNames=(a:Iterable<string>,b:Iterable<string>)=>
  assert.deepEqual([...a].sort(),[...b].sort());

test('main and Phase 3 migration filenames retain both independent 0050 and 0051 journals',()=>{
  for(const file of [...phase3Files,...purchaseFiles]){
    assert.ok(allFiles.includes(file),'Missing migration: '+file);
  }
  assert.equal(new Set(allFiles).size,allFiles.length);
  for(const prefix of ['0050_','0051_']){
    assert.equal(allFiles.filter(x=>x.startsWith(prefix)).length,2);
  }
});
for(const [label,exclude] of [
  ['main-to-combined upgrade',phase3Files],
  ['Phase-3-to-combined upgrade',purchaseFiles],
  ['fresh combined migration',new Set<string>()]
] as const){
  test(label+' retains all migration checksums and is idempotent',()=>{
    const root=mkdtempSync(join(tmpdir(),'hisabiq-phase3-upgrade-'));
    const subset=join(root,'old');
    const db=new SqliteDatabase(':memory:');
    try{
      cpSync(resolve('migrations'),subset,{recursive:true,filter:(src)=>{
        const name=src.split('/').pop()||'';
        return !exclude.has(name);
      }});
      const oldFiles=allFiles.filter(x=>!exclude.has(x));
      const old=runMigrations(db.native,subset);
      assert.equal(old.applied.length,oldFiles.length);
      assertEqualNames(old.applied,oldFiles);
      const delta=runMigrations(db.native,resolve('migrations'));
      assertEqualNames(delta.applied,exclude);
      assert.equal(delta.alreadyApplied,oldFiles.length);
      const rows=db.native.prepare('SELECT migration,checksum FROM schema_migrations').all() as
        Array<{migration:string;checksum:string}>;
      assertEqualNames(rows.map(x=>x.migration),allFiles);
      assert.ok(rows.every(x=>/^[a-f0-9]{64}$/.test(x.checksum)));
      const replay=runMigrations(db.native,resolve('migrations'));
      assert.deepEqual(replay.applied,[]);
      assert.equal(replay.alreadyApplied,allFiles.length);
      for(const table of ['customer_store_credit_entries','sale_tender_allocations',
        'split_partial_refund_allocations','purchase_unit_snapshots']){
        assert.ok(db.native.prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?"
        ).get(table),'Missing combined financial table: '+table);
      }
    }finally{db.close();rmSync(root,{recursive:true,force:true});}
  });
}
