import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SqliteDatabase } from '../server/db/sqlite.ts';
import { runMigrations } from '../server/db/migrate.ts';
import { handleApiRequest } from '../server/core/handler.ts';

// Full-migration, authenticated Hono -> SQLite/D1-compatible authorization checks.
async function fixture() {
  const db = new SqliteDatabase(':memory:');
  try {
    runMigrations(db.native, resolve('migrations'));
    const api = async (method: string, path: string, body?: unknown, token = '') => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = 'Bearer ' + token;
      const response = await handleApiRequest(new Request('http://isolated.invalid' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }), db);
      return { ...await response.json() as Record<string, any>, status: response.status };
    };
    const setup = await api('POST', '/api/setup/admin', {
      fullName: 'Business Owner',
      phone: '01000002601',
      password: 'Owner-Test-Password-2026!',
    });
    assert.equal(setup.status, 200, JSON.stringify(setup));
    const admin = setup.token as string;
    const managerRole = await api('POST', '/api/roles', {
      name: 'DelegatedManager',
      permissions: {
        roles: { view: true, add: true, edit: true, delete: true },
        users: { view: true, add: true, edit: true, delete: true },
        settings: { view: true, edit: true },
      },
    }, admin);
    assert.equal(managerRole.status, 200, JSON.stringify(managerRole));
    const privilegedRole = await api('POST', '/api/roles', {
      name: 'RestrictedReportsOwner',
      permissions: { reports: { view: true, edit: true } },
    }, admin);
    assert.equal(privilegedRole.status, 200, JSON.stringify(privilegedRole));
    const managerUser = await api('POST', '/api/users', {
      name: 'Delegated Manager',
      mobile: '01000002602',
      role: 'DelegatedManager',
      password: 'Manager-Test-Password-2026!',
    }, admin);
    assert.equal(managerUser.status, 200, JSON.stringify(managerUser));
    const signedIn = await api('POST', '/api/auth/login', {
      phone: '01000002602',
      password: 'Manager-Test-Password-2026!',
    });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn));
    return {
      db, api, admin, manager: signedIn.token as string,
      privilegedRoleId: privilegedRole.id as string,
    };
  } catch (cause) {
    db.close();
    throw cause;
  }
}

test('Phase 8A: delegated roles.add/edit cannot mint permissions the actor does not possess', async () => {
  const f = await fixture();
  try {
    const create = await f.api('POST', '/api/roles', {
      name: 'EscalatedReportReader',
      permissions: { reports: { view: true } },
    }, f.manager);
    assert.equal(create.status, 403, JSON.stringify(create));

    const edit = await f.api('PUT', '/api/roles/' + f.privilegedRoleId, {
      name: 'EscalatedReportWriter',
      permissions: { reports: { view: true, add: true, edit: true } },
    }, f.manager);
    assert.equal(edit.status, 403, JSON.stringify(edit));
    const stored = await f.api('GET', '/api/roles', undefined, f.admin);
    assert.equal(stored.status, 200);
    assert.ok(!stored.roles.some((role: any) => role.name === 'EscalatedReportReader'));
    assert.equal(stored.roles.find((role: any) => role.id === f.privilegedRoleId)?.name,
      'RestrictedReportsOwner');

    const allowed = await f.api('POST', '/api/roles', {
      name: 'BasicUserReader',
      permissions: { users: { view: true } },
    }, f.manager);
    assert.equal(allowed.status, 200, JSON.stringify(allowed));
  } finally { f.db.close(); }
});

test('Phase 8A: users.add/edit cannot assign an existing role more privileged than the actor', async () => {
  const f = await fixture();
  try {
    const elevated = await f.api('POST', '/api/users', {
      name: 'Unauthorized Report User',
      mobile: '01000002603',
      role: 'RestrictedReportsOwner',
      password: 'Ordinary-Password-2026!',
    }, f.manager);
    assert.equal(elevated.status, 403, JSON.stringify(elevated));

    const ordinary = await f.api('POST', '/api/users', {
      name: 'Permitted Staff',
      mobile: '01000002604',
      role: 'DelegatedManager',
      password: 'Ordinary-Password-2026!',
    }, f.manager);
    assert.equal(ordinary.status, 200, JSON.stringify(ordinary));

    const change = await f.api('PUT', '/api/users/' + ordinary.id, {
      name: 'Permitted Staff',
      mobile: '01000002604',
      role: 'RestrictedReportsOwner',
    }, f.manager);
    assert.equal(change.status, 403, JSON.stringify(change));
    const users = await f.api('GET', '/api/users', undefined, f.admin);
    assert.ok(!users.users.some((user: any) => user.mobile === '01000002603'));
    assert.equal(users.users.find((user: any) => user.id === ordinary.id)?.role, 'DelegatedManager');
  } finally { f.db.close(); }
});

test('Phase 8A: settings.edit cannot change session security policy or partially save a mixed request', async () => {
  const f = await fixture();
  try {
    const before = await f.api('GET', '/api/settings/bootstrap', undefined, f.admin);
    assert.equal(before.status, 200);
    const denied = await f.api('PUT', '/api/settings', {
      'Shop Name': 'Should Not Be Saved',
      'Session Timeout Hours': 720,
    }, f.manager);
    assert.equal(denied.status, 403, JSON.stringify(denied));
    const after = await f.api('GET', '/api/settings/bootstrap', undefined, f.admin);
    assert.equal(after.settings['Shop Name'], before.settings['Shop Name']);
    assert.equal(after.settings['Session Timeout Hours'], before.settings['Session Timeout Hours']);

    const ordinary = await f.api('PUT', '/api/settings', {
      'Shop Name': 'Updated Shop',
    }, f.manager);
    assert.equal(ordinary.status, 200, JSON.stringify(ordinary));
    const owner = await f.api('PUT', '/api/settings', {
      'Session Timeout Hours': 12,
    }, f.admin);
    assert.equal(owner.status, 200, JSON.stringify(owner));
    const updated = await f.api('GET', '/api/settings/bootstrap', undefined, f.admin);
    assert.equal(updated.settings['Shop Name'], 'Updated Shop');
    assert.equal(updated.settings['Session Timeout Hours'], '12');
  } finally { f.db.close(); }
});

test('Phase 8A: privileged role status/deletion cannot be controlled by less privileged role maintainers', async () => {
  const f = await fixture();
  try {
    const status = await f.api('PUT', '/api/roles/' + f.privilegedRoleId + '/status',
      { status: 'Inactive' }, f.manager);
    assert.equal(status.status, 403, JSON.stringify(status));
    const remove = await f.api('DELETE', '/api/roles/' + f.privilegedRoleId,
      undefined, f.manager);
    assert.equal(remove.status, 403, JSON.stringify(remove));
    const roles = await f.api('GET', '/api/roles', undefined, f.admin);
    assert.equal(roles.roles.find((role: any) => role.id === f.privilegedRoleId)?.status, 'Active');
  } finally { f.db.close(); }
});

test('Phase 8A: delegated user managers cannot reset, deactivate, or delete high-privilege account', async () => {
  const f = await fixture();
  try {
    const privilegedUser = await f.api('POST', '/api/users', {
      name: 'Report Access Holder',
      mobile: '01000002605',
      role: 'RestrictedReportsOwner',
      password: 'Report-Holder-Test-2026!',
    }, f.admin);
    assert.equal(privilegedUser.status, 200, JSON.stringify(privilegedUser));

    const reset = await f.api('POST', '/api/users/' + privilegedUser.id + '/reset-password',
      { newPassword: 'Changed-By-Manager-2026!' }, f.manager);
    assert.equal(reset.status, 403, JSON.stringify(reset));
    const deactivate = await f.api('PUT', '/api/users/' + privilegedUser.id + '/status',
      { status: 'Inactive' }, f.manager);
    assert.equal(deactivate.status, 403, JSON.stringify(deactivate));
    const remove = await f.api('DELETE', '/api/users/' + privilegedUser.id,
      undefined, f.manager);
    assert.equal(remove.status, 403, JSON.stringify(remove));

    const login = await f.api('POST', '/api/auth/login', {
      phone: '01000002605',
      password: 'Report-Holder-Test-2026!',
    });
    assert.equal(login.status, 200, JSON.stringify(login));
    const listed = await f.api('GET', '/api/users', undefined, f.admin);
    assert.equal(listed.users.find((user: any) => user.id === privilegedUser.id)?.status, 'Active');
  } finally { f.db.close(); }
});

test('Phase 8A: harmless view-only role remains delegable despite restrictive backdate setting', async () => {
  const f=await fixture();
  try{
    const restricted=await f.api('POST','/api/roles',{
      name:'ViewOnlyDelegator',
      permissions:{
        roles:{view:true,add:true},
        settings:{view:true,backdate:'disabled'}
      }
    },f.admin);
    assert.equal(restricted.status,200,JSON.stringify(restricted));
    const employee=await f.api('POST','/api/users',{
      name:'Viewer Role Manager',mobile:'01000002606',role:'ViewOnlyDelegator',
      password:'Viewer-Manager-Test-2026!'
    },f.admin);
    assert.equal(employee.status,200,JSON.stringify(employee));
    const logged=await f.api('POST','/api/auth/login',{
      phone:'01000002606',password:'Viewer-Manager-Test-2026!'
    });
    assert.equal(logged.status,200,JSON.stringify(logged));

    const allowed=await f.api('POST','/api/roles',{
      name:'SettingsReadOnly',
      permissions:{settings:{view:true}}
    },logged.token as string);
    assert.equal(allowed.status,200,JSON.stringify(allowed));

    const prohibited=await f.api('POST','/api/roles',{
      name:'SettingsEditorEscalation',
      permissions:{settings:{view:true,edit:true}}
    },logged.token as string);
    assert.equal(prohibited.status,403,JSON.stringify(prohibited));
    const roles=await f.api('GET','/api/roles',undefined,f.admin);
    assert.ok(!roles.roles.some((role:any)=>role.name==='SettingsEditorEscalation'));
  }finally{f.db.close();}
});
