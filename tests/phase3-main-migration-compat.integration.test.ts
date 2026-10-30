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
      // Preserve actual posted sale, cash and A/R evidence through either upgrade.
      const q=db.native;
      q.exec("INSERT INTO customers(customer_id,customer_name,phone,current_due,status,is_deleted) "+
        "VALUES ('UP-C','Upgrade Buyer','01000008401',0,'Active',0)");
      q.exec("INSERT INTO products(product_id,product_name,category,unit,purchase_price,selling_price,current_stock,status) "+
        "VALUES ('UP-P','Upgrade Cable','Electrical','Pcs',5,10,20,'Active')");
      q.exec("INSERT INTO sales(invoice_id,sale_date,customer_id,customer_name,customer_phone,"+
        "subtotal,grand_total,paid_amount,due_amount,payment_type,payment_status,payment_method,status,is_deleted) "+
        "VALUES ('UP-S','2026-10-30','UP-C','Upgrade Buyer','01000008401',40,40,40,0,'Cash','Paid','Cash','Completed',0)");
      q.exec("INSERT INTO sale_items(invoice_id,product_id,product_name,quantity,unit_price,line_total) "+
        "VALUES ('UP-S','UP-P','Upgrade Cable',4,10,40)");
      q.exec("INSERT INTO cash_book(entry_id,date,type,reference,description,debit,credit,payment_method,is_deleted) "+
        "VALUES ('UP-CASH','2026-10-30','Sale','UP-S','Original cash sale',0,40,'Cash',0)");
      const hadCredit=!exclude.has('0039_store_credit_liability.sql');
      if(hadCredit){
        q.exec("INSERT INTO sales_returns(return_id,return_date,invoice_id,customer_id,customer_name,"+
          "customer_phone,refund_method,total_return_amount,reason) "+
          "VALUES ('UP-R','2026-10-30','UP-S','UP-C','Upgrade Buyer','01000008401','Store Credit',10,'Verified original source')");
        q.exec("INSERT INTO sales_return_items(return_id,invoice_id,product_id,product_name,return_quantity,return_price,line_total) "+
          "VALUES ('UP-R','UP-S','UP-P','Upgrade Cable',1,10,10)");
        q.exec("INSERT INTO customer_store_credit_entries(entry_id,customer_id,entry_type,source_type,source_id,"+
          "delta_cents,balance_after_cents,created_by) "+
          "VALUES ('UP-ISSUE','UP-C','ISSUE','Sales Return','UP-R',1000,1000,'auditor')");
      }
      const beforeCustomer=q.prepare("SELECT current_due n FROM customers WHERE customer_id='UP-C'").get() as {n:number};
      const delta=runMigrations(db.native,resolve('migrations'));
      assert.equal((q.prepare("SELECT current_due n FROM customers WHERE customer_id='UP-C'").get() as any).n,beforeCustomer.n);
      assert.equal((q.prepare("SELECT current_stock n FROM products WHERE product_id='UP-P'").get() as any).n,20);
      assert.equal((q.prepare("SELECT paid_amount n FROM sales WHERE invoice_id='UP-S'").get() as any).n,40);
      assert.equal((q.prepare("SELECT credit n FROM cash_book WHERE reference='UP-S'").get() as any).n,40);
      assert.equal((q.prepare("SELECT COUNT(*) n FROM customer_ledger WHERE customer_id='UP-C'").get() as any).n,0);
      assert.equal((q.prepare("SELECT COALESCE(SUM(delta_cents),0) n FROM customer_store_credit_entries WHERE customer_id='UP-C'").get() as any).n,
        hadCredit?1000:0,'upgrading must neither erase liability nor manufacture legacy credit');
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
