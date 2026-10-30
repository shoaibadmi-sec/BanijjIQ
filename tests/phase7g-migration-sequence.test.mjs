import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const cli=resolve('scripts/check-migration-sequence.mjs');
function run(names){
  const dir=mkdtempSync(join(tmpdir(),'hisabiq-phase7g1-'));
  try {
    for(const name of names)writeFileSync(join(dir,name),'-- fixture, never executed\n');
    return spawnSync(process.execPath,[cli,dir],{encoding:'utf8',timeout:5000});
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('Phase 7G1: conflicting Phase7C and bundle refunds 0060 migration IDs are rejected before DB writes',()=>{
  const result=run(['0059_bundle_atomic_cash.sql','0060_inventory_loss_journal.sql','0060_bundle_cash_full_returns.sql']);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Duplicate migration version 0060/i);
  assert.match(result.stderr,/0060_inventory_loss_journal\.sql/);
  assert.match(result.stderr,/0060_bundle_cash_full_returns\.sql/);
});
test('Phase 7G1: conflicting physical stocktaking and bundle partial returns 0061 IDs are rejected',()=>{
  const result=run(['0061_physical_stocktaking.sql','0061_bundle_partial_returns.sql']);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Duplicate migration version 0061/i);
});
test('Phase 7G1: leading zero variants cannot bypass version collision check',()=>{
  const result=run(['0060_a.sql','60_b.sql']);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Duplicate migration version/i);
});
test('Phase 7G1: unique sequential and gapped historical versions are permitted',()=>{
  const result=run(['0001_a.sql','0005_b.sql','0029_c.sql','0058_d.sql','0059_e.sql','0060_f.sql','README.md']);
  assert.equal(result.status,0,result.stderr);
});
test('Phase 7G1: checked-in real migrations pass the guard',()=>{
  const result=spawnSync(process.execPath,[cli,resolve('migrations')],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
});
test('Phase 7G1: missing migration directory fails closed',()=>{
  const result=spawnSync(process.execPath,[cli,resolve('migrations/do-not-exist')],{encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/ENOENT|not found|no such/i);
});
