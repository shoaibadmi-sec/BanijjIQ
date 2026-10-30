import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

test('Phase 6A bank reconciliation is authenticated, book-backed, and read only', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    let token = '';
    const get = async (path: string) => {
      const res = await handleApiRequest(new Request('https://isolated.test' + path, {
        headers: token ? { authorization: 'Bearer ' + token } : undefined
      }), db);
      return { status: res.status, ...await res.json() as Record<string, any> };
    };
    assert.equal((await get('/api/bank/reconciliation')).status, 401);
    const setup = await handleApiRequest(new Request('https://isolated.test/api/setup/admin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Phase 6 Accountant', phone: '01000008661', password: 'LocalOnlyPassword2026' })
    }), db);
    const created = await setup.json() as { token?: string };
    assert.equal(setup.status, 200);
    token = created.token!;

    // A finance-only role cannot see private bank accounts.
    const restrictedToken = 'phase6-finance-only-credential';
    const hash = createHash('sha256').update(restrictedToken).digest('base64');
    db.native.prepare("INSERT INTO app_roles(role_name,permissions_json) VALUES ('finance-only-6a',?)")
      .run(JSON.stringify({ finance: { view: true, add: false, edit: false } }));
    db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES ('finance-only-6a','Finance Only','01000008662','fixture','fixture','finance-only-6a','Active','Fixture')").run();
    db.native.prepare("INSERT INTO auth_sessions(session_id,user_id,token_hash,expires_at) VALUES ('finance-session-6a','finance-only-6a',?,datetime('now','+2 hours'))").run(hash);
    const adminToken = token;
    token = restrictedToken;
    assert.equal((await get('/api/bank/reconciliation')).status, 403);
    assert.equal((await get('/api/finance/bootstrap')).status, 200);
    token = adminToken;

    db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,opening_balance,current_balance) VALUES ('BK-6A-OK','Shop Bank',100.1234,125.6234),('BK-6A-DRIFT','Other Bank',0,100),('BK-6A-OPEN','Opening Row Bank',0,70)").run();
    db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,debit,credit) VALUES "+
      "('BB-6A-1','BK-6A-OK','2026-10-29','Deposit','D1',0,35.5),"+
      "('BB-6A-2','BK-6A-OK','2026-10-29','Charge','C1',10,0),"+
      "('BB-6A-3','BK-6A-DRIFT','2026-10-29','Deposit','D2',0,90),"+
      "('BB-6A-4','BK-6A-OPEN','2026-10-29','Opening Balance','OPEN',0,70)").run();
    const before = (db.native.prepare('SELECT total_changes() AS changes').get() as { changes: number }).changes;
    const value = await get('/api/bank/reconciliation');
    assert.equal(value.status, 200, JSON.stringify(value));
    assert.equal(value.coverage.status, 'needs-review');
    const ok = value.accounts.find((a: any) => a.id === 'BK-6A-OK');
    assert.equal(ok.status, 'ready');
    assert.equal(ok.bookBalance, 125.6234);
    assert.equal(ok.recordedBalance, 125.6234);
    assert.match(ok.reason, /book/i);
    const drift = value.accounts.find((a: any) => a.id === 'BK-6A-DRIFT');
    assert.equal(drift.status, 'needs-review');
    assert.equal(drift.bookBalance, null, 'do not present a disputed balance as verified');
    assert.equal(drift.recordedBalance, 100);
    assert.equal(value.accounts.find((a: any) => a.id === 'BK-6A-OPEN').bookBalance, 70,
      'opening balance stored as a book row must not be counted twice');
    const after = (db.native.prepare('SELECT total_changes() AS changes').get() as { changes: number }).changes;
    assert.equal(after, before, 'GET must never post or mutate money');
  } finally { db.close(); }
});

test('Phase 6A reconciliation withholds totals for orphan book rows and invalid amounts', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    db.native.prepare("INSERT INTO bank_accounts(bank_account_id,account_name,opening_balance,current_balance) VALUES ('BK-ORPH','Safe Bank',0,0)").run();
    db.native.prepare("INSERT INTO bank_book(entry_id,bank_account_id,date,type,reference,debit,credit) VALUES ('BB-ORPH','UNKNOWN-BANK','2026-10-29','Deposit','X',0,10)").run();
    const { getBankReconciliationRoute } = await import('../server/modules/finance/service.ts');
    const response = await getBankReconciliationRoute(db);
    const value = await response.json() as any;
    assert.equal(value.coverage.status, 'needs-review');
    assert.equal(value.accounts.find((a: any) => a.id === 'BK-ORPH').status, 'needs-review');
    assert.match(value.coverage.reason, /missing account|orphan/i);
  } finally { db.close(); }
});
