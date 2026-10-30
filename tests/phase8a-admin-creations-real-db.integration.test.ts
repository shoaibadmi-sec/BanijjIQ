import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

// Real migrated SQLite and authenticated Hono routes, not Playwright fixture APIs.
// Everything is in-memory. No remote D1 credentials, network, or production bindings.
test('Phase 8A3B: administrator-created role and user persist; unauthorized users cannot escalate',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    let adminToken='';
    const api=async(method:string,path:string,body?:unknown,token=adminToken)=>{
      const headers:Record<string,string>={'content-type':'application/json'};
      if(token)headers.authorization='Bearer '+token;
      const response=await handleApiRequest(new Request('https://isolated.invalid'+path,{
        method,headers,body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as Record<string,any>};
    };
    const owner=await api('POST','/api/setup/admin',{
      fullName:'Local Test Owner',phone:'01000009701',password:'local-only-owner-password-2026'
    },'');
    assert.equal(owner.status,200,JSON.stringify({status:owner.status,error:owner.error}));
    adminToken=owner.token;
    assert.ok(adminToken);

    const initial=await api('GET','/api/roles');
    assert.equal(initial.status,200);
    assert.ok(initial.moduleOptions.some((m:any)=>m.key==='returns'));
    assert.ok(initial.deleteWindowOptions.some((w:any)=>w.key==='same'));
    assert.ok(initial.deleteWindowOptions.some((w:any)=>w.key==='7'));

    const permissions={
      products:{view:true,add:true,edit:true,delete:'disabled',backdate:'disabled'},
      returns:{view:true,add:false,edit:false,delete:'same',backdate:'7'},
      users:{view:true,add:false,edit:false,delete:true,backdate:'disabled'}
    };
    const createdRole=await api('POST','/api/roles',{
      name:'Warehouse Supervisor',permissions
    });
    assert.equal(createdRole.status,200,JSON.stringify({status:createdRole.status,error:createdRole.error}));
    assert.ok(createdRole.id);
    const storedRole=db.native.prepare('SELECT role_name,allowed_modules,permissions_json FROM app_roles WHERE role_id=?')
      .get(createdRole.id) as {role_name:string;allowed_modules:string;permissions_json:string};
    assert.equal(storedRole.role_name,'Warehouse Supervisor');
    assert.deepEqual(storedRole.allowed_modules.split(','),['products','returns','users']);
    assert.deepEqual(JSON.parse(storedRole.permissions_json),permissions,
      'disabled delete/backdate values must survive storage exactly');
    const fetched=await api('GET','/api/roles');
    assert.equal(fetched.status,200);
    assert.deepEqual(fetched.roles.find((r:any)=>r.id===createdRole.id)?.permissions,permissions);
    const duplicate=await api('POST','/api/roles',{name:'warehouse supervisor',permissions});
    assert.equal(duplicate.status,400);
    assert.equal((db.native.prepare('SELECT COUNT(*) c FROM app_roles').get() as any).c,1);
    const protectedRole=await api('POST','/api/roles',{name:'Administrator',permissions});
    assert.equal(protectedRole.status,400);

    const password='local-only-staff-password-2026';
    const createdUser=await api('POST','/api/users',{
      name:'Warehouse Employee',mobile:'01000009702',role:'Warehouse Supervisor',password
    });
    assert.equal(createdUser.status,200,JSON.stringify({status:createdUser.status,error:createdUser.error}));
    const storedUser=db.native.prepare('SELECT full_name,phone,role,status,password_hash,password_salt FROM app_users WHERE user_id=?')
      .get(createdUser.id) as any;
    assert.equal(storedUser.full_name,'Warehouse Employee');
    assert.equal(storedUser.role,'Warehouse Supervisor');
    assert.equal(storedUser.status,'Active');
    assert.ok(storedUser.password_hash);
    assert.notEqual(storedUser.password_hash,password,'password must be hashed, not stored in plaintext');
    assert.ok(storedUser.password_salt);
    const userList=await api('GET','/api/users');
    assert.equal(userList.status,200);
    assert.equal(userList.users.find((u:any)=>u.id===createdUser.id)?.name,'Warehouse Employee');
    assert.ok(!JSON.stringify(userList).includes(password),'user listing must never disclose password');

    const login=await api('POST','/api/auth/login',{phone:'01000009702',password},'');
    assert.equal(login.status,200,JSON.stringify({status:login.status,error:login.error}));
    assert.ok(login.token);
    const authorized=await api('GET','/api/users',undefined,login.token);
    assert.equal(authorized.status,200,'explicit users.view is granted');
    const noCreate=await api('POST','/api/users',{
      name:'Escalated Employee',mobile:'01000009703',
      role:'Warehouse Supervisor',password:'local-only-escalation-password'
    },login.token);
    assert.equal(noCreate.status,403,'users.add is disabled');
    const noRoles=await api('GET','/api/roles',undefined,login.token);
    assert.equal(noRoles.status,403,'roles.view is not granted');
    const noEscalate=await api('POST','/api/roles',{
      name:'Escalated Role',permissions:{settings:{view:true,edit:true}}
    },login.token);
    assert.equal(noEscalate.status,403);
    const duplicatePhone=await api('POST','/api/users',{
      name:'Duplicate',mobile:'01000009702',role:'Warehouse Supervisor',
      password:'local-only-other-password'
    });
    assert.equal(duplicatePhone.status,400);
    assert.equal((db.native.prepare("SELECT COUNT(*) c FROM app_users WHERE role='Warehouse Supervisor'").get() as any).c,1);
    assert.equal((db.native.prepare('SELECT COUNT(*) c FROM app_roles').get() as any).c,1);
  }finally{db.close();}
});