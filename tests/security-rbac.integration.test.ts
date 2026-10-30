import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

async function isolatedUsersFixture() {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    const api = async (method: string, path: string, body?: unknown, token = '') => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = 'Bearer ' + token;
      const response = await handleApiRequest(new Request('http://isolated.invalid' + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      }), db);
      return { ...await response.json() as Record<string, any>, status: response.status };
    };
    const adminPassword = 'Original-Admin-Secret-2026!';
    const created = await api('POST', '/api/setup/admin', {
      fullName: 'Original Administrator', phone: '01000002501', password: adminPassword,
    });
    assert.equal(created.status, 200, JSON.stringify(created));
    const adminToken = created.token as string;
    const adminId = created.user.userId as string;
    const role = await api('POST', '/api/roles', {
      name: 'CashierAdminTools',
      permissions: {
        users: { view: true, edit: true, delete: true },
        reports: { view: true },
      },
    }, adminToken);
    assert.equal(role.status, 200, JSON.stringify(role));
    const member = await api('POST', '/api/users', {
      name: 'Restricted Manager', mobile: '01000002502',
      role: 'CashierAdminTools', password: 'Cashier-Original-2026!',
    }, adminToken);
    assert.equal(member.status, 200, JSON.stringify(member));
    const staff = await api('POST', '/api/auth/login', {
      phone: '01000002502', password: 'Cashier-Original-2026!',
    });
    assert.equal(staff.status, 200, JSON.stringify(staff));
    return { db, api, adminToken, staffToken: staff.token as string, adminId, adminPassword, roleId: role.id as string };
  } catch (err) {
    db.close();
    throw err;
  }
}

test('RBAC: users.edit cannot reset a built-in administrator password', async () => {
  const f = await isolatedUsersFixture();
  try {
    const changedPassword = 'Attacker-Selected-Password-2026!';
    const result = await f.api('POST', '/api/users/' + f.adminId + '/reset-password',
      { newPassword: changedPassword }, f.staffToken);
    assert.equal(result.status, 403, JSON.stringify(result));
    assert.equal((await f.api('POST', '/api/auth/login', {
      phone: '01000002501', password: f.adminPassword,
    })).status, 200, 'original admin secret must keep working');
    assert.equal((await f.api('POST', '/api/auth/login', {
      phone: '01000002501', password: changedPassword,
    })).status, 401, 'restricted manager must not take over administrator account');
  } finally { f.db.close(); }
});

test('RBAC: users.edit cannot change a built-in administrator login identifier', async () => {
  const f = await isolatedUsersFixture();
  try {
    const result = await f.api('PUT', '/api/users/' + f.adminId, {
      name: 'Renamed Administrator', mobile: '01000002599', role: 'admin',
    }, f.staffToken);
    assert.equal(result.status, 403, JSON.stringify(result));
    assert.equal((await f.api('POST', '/api/auth/login', {
      phone: '01000002501', password: f.adminPassword,
    })).status, 200, 'administrator phone must not be modified by restricted manager');
  } finally { f.db.close(); }
});

test('RBAC: inactive roles stop granting reporting permissions to existing sessions', async () => {
  const f = await isolatedUsersFixture();
  try {
    assert.equal((await f.api('GET', '/api/reports/v2/catalog', undefined, f.staffToken)).status, 200);
    const changed = await f.api('PUT', '/api/roles/' + f.roleId + '/status',
      { status: 'Inactive' }, f.adminToken);
    assert.equal(changed.status, 200, JSON.stringify(changed));
    const denied = await f.api('GET', '/api/reports/v2/catalog', undefined, f.staffToken);
    assert.equal(denied.status, 403, JSON.stringify(denied));
    const enabled = await f.api('PUT', '/api/roles/' + f.roleId + '/status',
      { status: 'Active' }, f.adminToken);
    assert.equal(enabled.status, 200);
    assert.equal((await f.api('GET', '/api/reports/v2/catalog', undefined, f.staffToken)).status, 200,
      'reactivation may restore the role according to current session policy');
  } finally { f.db.close(); }
});

test('RBAC: users.edit cannot disable another administrator even if two admins exist', async () => {
  const f = await isolatedUsersFixture();
  try {
    const other = await f.api('POST', '/api/users', {
      name: 'Second Administrator', mobile: '01000002503',
      role: 'admin', password: 'Second-Admin-Secret-2026!',
    }, f.adminToken);
    assert.equal(other.status, 200, JSON.stringify(other));
    const attempt = await f.api('PUT', '/api/users/' + other.id + '/status',
      { status: 'Inactive' }, f.staffToken);
    assert.equal(attempt.status, 403, JSON.stringify(attempt));
    assert.equal((await f.api('POST', '/api/auth/login', {
      phone: '01000002503', password: 'Second-Admin-Secret-2026!',
    })).status, 200);
  } finally { f.db.close(); }
});

test('RBAC: users.delete cannot delete another administrator even with two admins', async () => {
  const f = await isolatedUsersFixture();
  try {
    const other = await f.api('POST', '/api/users', {
      name: 'Second Administrator', mobile: '01000002503',
      role: 'admin', password: 'Second-Admin-Secret-2026!',
    }, f.adminToken);
    assert.equal(other.status, 200, JSON.stringify(other));
    const attempt = await f.api('DELETE', '/api/users/' + other.id,
      undefined, f.staffToken);
    assert.equal(attempt.status, 403, JSON.stringify(attempt));
    assert.equal((await f.api('POST', '/api/auth/login', {
      phone: '01000002503', password: 'Second-Admin-Secret-2026!',
    })).status, 200);
  } finally { f.db.close(); }
});


test('RBAC: delegated users.edit cannot reset another staff password', async () => {
  const f = await isolatedUsersFixture();
  try {
    const originalPassword = 'Warehouse-Original-2026!';
    const newPassword = 'Unauthorized-Replacement-2026!';
    const target = await f.api('POST', '/api/users', {
      name: 'Warehouse Operator', mobile: '01000002504',
      role: 'CashierAdminTools', password: originalPassword,
    }, f.adminToken);
    assert.equal(target.status, 200, JSON.stringify(target));
    const loggedIn = await f.api('POST', '/api/auth/login', {
      phone: '01000002504', password: originalPassword,
    });
    assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn));

    const attempt = await f.api('POST', '/api/users/' + target.id + '/reset-password',
      { newPassword }, f.staffToken);
    assert.equal(attempt.status, 403, 'users.edit must not grant credential reset authority');
    assert.equal((await f.api('POST', '/api/auth/login', {
      phone: '01000002504', password: originalPassword,
    })).status, 200, 'existing password must remain valid');
    assert.equal((await f.api('POST', '/api/auth/login', {
      phone: '01000002504', password: newPassword,
    })).status, 401, 'delegated actor must not install a new credential');
    const session = await f.api('GET', '/api/auth/me', undefined, loggedIn.token);
    assert.equal(session.user?.userId, target.id,
      'a rejected reset must not revoke the target session');
  } finally { f.db.close(); }
});
