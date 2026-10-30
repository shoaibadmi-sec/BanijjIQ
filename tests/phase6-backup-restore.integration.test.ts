import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hisabiq-phase6-backup-'));
  const source = join(dir, 'live.sqlite');
  const db = new SqliteDatabase(source);
  runMigrations(db.native, resolve('migrations'));
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES ('6J-BANK','Shop Bank','Bank',100,112.3456,'Active')").run();
  db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,debit,credit) VALUES ('6J-BOOK','6J-BANK','2026-10-30','Deposit','6J-REF',0,12.3456)").run();
  db.native.prepare("INSERT INTO finance_persons(person_id,person_name,person_type) VALUES ('6J-OWNER','Opening Owner','Owner')").run();
  db.native.prepare("INSERT INTO finance_transactions(finance_id,date,transaction_type,person_id,person_name,payment_method,amount) VALUES ('6J-FIN','2026-10-30','Owner Investment','6J-OWNER','Opening Owner','Cash',40.1250)").run();
  db.native.prepare("INSERT INTO expense_categories(category_id,category_name) VALUES ('6J-CAT','Rent')").run();
  db.native.prepare("INSERT INTO expenses(expense_id,expense_date,category_id,category_name,amount,payment_method) VALUES ('6J-EXP','2026-10-30','6J-CAT','Rent',7.2500,'Cash')").run();
  return {dir,source,db,backup:join(dir,'snapshot.sqlite')};
}

const financialTables = ['bank_accounts','bank_book','finance_persons','finance_transactions','expenses','expense_categories','schema_migrations'];
function snapshot(db:SqliteDatabase) {
  return Object.fromEntries(financialTables.map(table =>
    [table,db.native.prepare('SELECT * FROM "'+table+'" ORDER BY rowid').all()]));
}

test('6J online SQLite backup restores committed finance and bank rows without losing WAL writes', async () => {
  const f=fixture();
  try {
    assert.equal(typeof (f.db as any).backupTo, 'function', 'online backup method must exist');
    const before=snapshot(f.db);
    assert.equal(f.db.native.pragma('journal_mode',{simple:true}),'wal');
    await (f.db as any).backupTo(f.backup);
    assert.ok(existsSync(f.backup));
    const restored=new SqliteDatabase(f.backup);
    try {
      assert.deepEqual(snapshot(restored),before,'backup must retain every original book and migration row');
      assert.equal(restored.native.pragma('integrity_check',{simple:true}),'ok');
      assert.deepEqual(restored.native.pragma('foreign_key_check'),[]);
      assert.equal(runMigrations(restored.native,resolve('migrations')).applied.length,0);
      assert.deepEqual(snapshot(restored),before,'migration replay after restore must not change financial data');
      f.db.native.prepare("UPDATE bank_accounts SET current_balance=999 WHERE bank_account_id='6J-BANK'").run();
      assert.deepEqual(snapshot(restored),before,'backup must be an independent point-in-time snapshot');
    } finally { restored.close(); }
  } finally {f.db.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('6J backup refuses source-file overwrite and pre-existing snapshot without mutating money', async () => {
  const f=fixture();
  try {
    assert.equal(typeof (f.db as any).backupTo,'function','online backup method must exist');
    const before=snapshot(f.db);
    await assert.rejects((f.db as any).backupTo(f.source),/same|source|exists|overwrite/i);
    await (f.db as any).backupTo(f.backup);
    await assert.rejects((f.db as any).backupTo(f.backup),/exists|overwrite/i);
    assert.deepEqual(snapshot(f.db),before);
    const restored=new SqliteDatabase(f.backup);
    try {assert.deepEqual(snapshot(restored),before);}
    finally {restored.close();}
  } finally {f.db.close();rmSync(f.dir,{recursive:true,force:true});}
});

test('6J backup refuses a dangling symlink destination without writing its target', async () => {
  const f=fixture();
  try {
    const target=join(f.dir,'uncreated-target.sqlite');
    const alias=join(f.dir,'snapshot-alias.sqlite');
    symlinkSync(target,alias);
    const before=snapshot(f.db);
    await assert.rejects(f.db.backupTo(alias),/exists|overwrite|symlink/i);
    assert.equal(existsSync(target),false,'backup must not follow a dangling symlink');
    assert.equal(lstatSync(alias).isSymbolicLink(),true);
    assert.deepEqual(snapshot(f.db),before,'rejected destination must not mutate source');
  } finally {f.db.close();rmSync(f.dir,{recursive:true,force:true});}
});
