import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

test('Phase 7G1: direct SQLite migration runner also rejects duplicate numeric prefixes before applying either DDL',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hisabiq-phase7g-runtime-'));
  const db=new SqliteDatabase(':memory:');
  try {
    writeFileSync(join(dir,'0060_inventory_loss_journal.sql'),'CREATE TABLE applied_damage (id INTEGER);');
    writeFileSync(join(dir,'0060_bundle_cash_full_returns.sql'),'CREATE TABLE applied_bundle_refund (id INTEGER);');
    assert.throws(()=>runMigrations(db.native,dir),/Duplicate migration version 0060/);
    assert.equal((db.native.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN ('applied_damage','applied_bundle_refund')").get() as {count:number}).count,0,
      'must reject before any business DDL');
  }finally {
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
