import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,copyFileSync,readFileSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';

// Rehearsal uses ONLY a temporary SQLite file and copied migration files:
// no Cloudflare credentials, remote database, deployment or production schema.
const source=resolve('migrations');
const files=readdirSync(source).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
const phase6=files.filter(n=>Number(n.slice(0,4))>=60);
const baseline=files.filter(n=>Number(n.slice(0,4))<60);
const tables=['bank_accounts','bank_book','bank_transfers','cash_sessions','cash_book',
 'finance_persons','finance_transactions','expense_categories','expenses'];

test('6H upgrade rehearsal preserves legacy financial rows and replay is idempotent',()=>{
 assert.deepEqual(phase6.map(n=>Number(n.slice(0,4))),[60,61,62,63,64,65,66,67,68]);
 const sandbox=mkdtempSync(join(tmpdir(),'hisabiq-phase6-migration-'));
 const stage=join(sandbox,'migrations');
 mkdirSync(stage);
 for(const f of baseline)copyFileSync(join(source,f),join(stage,f));
 const db=new SqliteDatabase(join(sandbox,'business.sqlite'));
 try{
  const original=runMigrations(db.native,stage);
  assert.equal(original.applied.length,baseline.length);
  db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,account_type,opening_balance,current_balance,status) VALUES ('P6H-B1','Main Bank','Bank',500,520,'Active'),('P6H-B2','Mobile Wallet','Mobile Banking',100,95,'Active')").run();
  db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,debit,credit) VALUES ('P6H-BB','P6H-B1','2026-10-30','Interest Received','P6H-SRC',0,20)").run();
  db.native.prepare("INSERT INTO bank_transfers(transfer_id,transfer_date,from_account_id,from_account_name,to_account_id,to_account_name,amount) VALUES ('P6H-TX','2026-10-30','P6H-B2','Mobile Wallet','P6H-B1','Main Bank',5)").run();
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash,status) VALUES ('P6H-CS','Counter Cashier',100,'Open')").run();
  db.native.prepare("INSERT INTO cash_book(entry_id,date,type,reference,debit,credit) VALUES ('P6H-CB-OPEN','2026-10-30','Session Open','P6H-CS',0,100),('P6H-CB-EXP','2026-10-30','Expense','P6H-EXP',9,0)").run();
  db.native.prepare("INSERT INTO finance_persons(person_id,person_name,person_type) VALUES ('P6H-OWNER','Original Owner','Owner')").run();
  db.native.prepare("INSERT INTO finance_transactions(finance_id,date,transaction_type,person_id,person_name,payment_method,amount) VALUES ('P6H-FIN','2026-10-30','Owner Investment','P6H-OWNER','Original Owner','Cash',50)").run();
  db.native.prepare("INSERT INTO expense_categories(category_id,category_name) VALUES ('P6H-CAT','Electricity')").run();
  db.native.prepare("INSERT INTO expenses(expense_id,expense_date,category_id,category_name,amount,payment_method) VALUES ('P6H-EXP','2026-10-30','P6H-CAT','Electricity',9,'Cash')").run();

  const columns=new Map<string,string[]>();
  for(const name of tables) columns.set(name,(db.native.prepare('PRAGMA table_info("'+name+'")').all() as any[]).map(x=>x.name));
  const snapshot=()=>Object.fromEntries(tables.map(name=>{
   const oldCols=columns.get(name)!;
   const sql='SELECT '+oldCols.map(x=>'"'+x+'"').join(',')+' FROM "'+name+'" ORDER BY rowid';
   return [name,db.native.prepare(sql).all()];
  }));
  const before=snapshot();
  for(const f of phase6)copyFileSync(join(source,f),join(stage,f));
  const upgraded=runMigrations(db.native,stage);
  assert.deepEqual(upgraded.applied,phase6);
  assert.deepEqual(snapshot(),before,'migration must not rewrite original financial rows');
  assert.throws(()=>db.native.prepare("UPDATE finance_persons SET person_type='Lender' WHERE person_id='P6H-OWNER'").run(),
    /Finance person type cannot change after history exists/,
    'upgrade installs historical finance-person type guard');
  assert.deepEqual(snapshot(),before,'rejected identity change leaves historical books intact');
  assert.equal((db.native.prepare('PRAGMA integrity_check').get() as any).integrity_check,'ok');
  assert.deepEqual(db.native.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(runMigrations(db.native,stage).applied.length,0,'replay must not duplicate migrations');
  assert.deepEqual(snapshot(),before);

  const valid=join(stage,phase6[phase6.length-1]);
  const originalSql=readFileSync(valid,'utf8');
  writeFileSync(valid,originalSql+'\n-- unauthorized history edit\n');
  assert.throws(()=>runMigrations(db.native,stage),/modified after it was applied/);
  writeFileSync(valid,originalSql);
  assert.deepEqual(snapshot(),before,'checksum rejection cannot change financial data');

  const broken='0099_rehearsal_failure.sql';
  writeFileSync(join(stage,broken),
   "INSERT INTO expense_categories(category_id,category_name) VALUES ('P6H-PARTIAL','MUST ROLLBACK');\nINSERT INTO no_such_table(x) VALUES (1);\n");
  assert.throws(()=>runMigrations(db.native,stage));
  assert.equal((db.native.prepare("SELECT COUNT(*) n FROM expense_categories WHERE category_id='P6H-PARTIAL'").get() as any).n,0,
   'failed migration must roll back its earlier successful statement');
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE migration=?').get(broken) as any).n,0);
  assert.deepEqual(snapshot(),before);
  unlinkSync(join(stage,broken));
  assert.deepEqual(runMigrations(db.native,stage).applied,[]);
  assert.deepEqual(snapshot(),before);
 }finally{db.close();rmSync(sandbox,{recursive:true,force:true});}
});

test('6H duplicate legacy open sessions block the migration atomically and allow a reconciled retry',()=>{
 const sandbox=mkdtempSync(join(tmpdir(),'hisabiq-phase6-duplicate-'));
 const stage=join(sandbox,'migrations');
 mkdirSync(stage);
 for(const f of files.filter(n=>Number(n.slice(0,4))<62))
   copyFileSync(join(source,f),join(stage,f));
 const db=new SqliteDatabase(join(sandbox,'business.sqlite'));
 try{
  runMigrations(db.native,stage);
  db.native.prepare("INSERT INTO cash_sessions(session_id,opened_by,opening_cash,status) VALUES ('P6H-DUP-A','Historical Cashier',100,'Open'),('P6H-DUP-B','Historical Cashier',200,'Open')").run();
  const before=db.native.prepare('SELECT session_id,opening_cash,status FROM cash_sessions ORDER BY session_id').all();
  for(const f of phase6.filter(n=>Number(n.slice(0,4))>=62))
   copyFileSync(join(source,f),join(stage,f));
  const failed='0062_phase6_cash_session_guards.sql';
  assert.throws(()=>runMigrations(db.native,stage),/UNIQUE constraint failed|idx_phase6_cash_only_one_open/i);
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE migration=?').get(failed) as any).n,0);
  assert.equal((db.native.prepare("SELECT COUNT(*) n FROM pragma_table_info('cash_sessions') WHERE name='client_request_id'").get() as any).n,0,
   'a failed ALTER/CREATE INDEX sequence must not leave partial schema edits');
  assert.deepEqual(db.native.prepare('SELECT session_id,opening_cash,status FROM cash_sessions ORDER BY session_id').all(),before);
  db.native.prepare("UPDATE cash_sessions SET status='Closed' WHERE session_id='P6H-DUP-A'").run();
  const retried=runMigrations(db.native,stage);
  assert.equal(retried.applied.length,7,'once legacy state is resolved, apply exactly migrations 0062–0068');
  assert.equal((db.native.prepare("SELECT COUNT(*) n FROM cash_sessions WHERE status='Open'").get() as any).n,1);
  assert.equal((db.native.prepare("SELECT COUNT(*) n FROM cash_book WHERE type='Day Close Adjustment'").get() as any).n,0);
  assert.equal((db.native.prepare('PRAGMA integrity_check').get() as any).integrity_check,'ok');
 }finally{db.close();rmSync(sandbox,{recursive:true,force:true});}
});
