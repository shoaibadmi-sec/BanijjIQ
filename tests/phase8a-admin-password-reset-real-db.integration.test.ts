import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

// Runs with a fully migrated, isolated in-memory DB. Tests the real HTTP handler,
// password hashing, authenticated roles, and session invalidation (no live D1).
test('Phase 8A3B4: only administrator can reset an employee password; all prior sessions revoked',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    const api=async(method:string,path:string,body?:unknown,token='')=>{
      const headers:Record<string,string>={'content-type':'application/json'};
      if(token)headers.authorization='Bearer '+token;
      const response=await handleApiRequest(new Request('https://isolated.invalid'+path,{
        method,headers,body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:response.status,...await response.json() as Record<string,any>};
    };
    const owner=await api('POST','/api/setup/admin',{
      fullName:'Local Password Reset Admin',phone:'01000008701',
      password:'local-admin-password-not-a-secret'
    });
    assert.equal(owner.status,200);const adminToken=owner.token as string;
    const viewerRole=await api('POST','/api/roles',{
      name:'Phase8A Restricted Staff',permissions:{products:{view:true}}
    },adminToken);
    assert.equal(viewerRole.status,200);
    const managerRole=await api('POST','/api/roles',{
      name:'Phase8A Delegated Manager',permissions:{users:{
        view:true,add:false,edit:true,delete:false,backdate:'disabled'
      }}
    },adminToken);
    assert.equal(managerRole.status,200);
    const original='original-test-only-password-2026';
    const staff=await api('POST','/api/users',{
      name:'Password Reset Target',mobile:'01000008702',
      role:'Phase8A Restricted Staff',password:original
    },adminToken);
    assert.equal(staff.status,200);const targetId=staff.id as string;
    const manager=await api('POST','/api/users',{
      name:'Untrusted Delegated Manager',mobile:'01000008703',
      role:'Phase8A Delegated Manager',password:'manager-test-only-password-2026'
    },adminToken);
    assert.equal(manager.status,200);
    const managerSession=await api('POST','/api/auth/login',{
      phone:'01000008703',password:'manager-test-only-password-2026'
    });
    assert.equal(managerSession.status,200);
    const targetSession=await api('POST','/api/auth/login',{
      phone:'01000008702',password:original
    });
    assert.equal(targetSession.status,200);
    const originalHash=(db.native.prepare('SELECT password_hash FROM app_users WHERE user_id=?')
      .get(targetId) as any).password_hash;
    // Even a non-admin with users.edit may not reset someone else's credentials.
    const unauthorized=await api('POST','/api/users/'+targetId+'/reset-password',{
      newPassword:'attacker-controlled-password-2026'
    },managerSession.token);
    assert.equal(unauthorized.status,403,'delegated users.edit cannot reset credentials');
    assert.equal((db.native.prepare('SELECT password_hash FROM app_users WHERE user_id=?')
      .get(targetId) as any).password_hash,originalHash,
      'forbidden password-reset must preserve stored hash');
    const stillValid=await api('GET','/api/auth/me',undefined,targetSession.token);
    assert.equal(stillValid.user?.userId,targetId,
      'unauthorized attempt must not terminate the real employee session');
    const weak=await api('POST','/api/users/'+targetId+'/reset-password',{
      newPassword:'123'
    },adminToken);
    assert.equal(weak.status,400);
    const updated='new-test-only-password-2026!';
    const reset=await api('POST','/api/users/'+targetId+'/reset-password',{
      newPassword:updated
    },adminToken);
    assert.equal(reset.status,200,JSON.stringify({status:reset.status,error:reset.error}));
    assert.equal(reset.id,targetId);
    const updatedHash=(db.native.prepare('SELECT password_hash FROM app_users WHERE user_id=?')
      .get(targetId) as any).password_hash;
    assert.notEqual(updatedHash,originalHash);
    assert.notEqual(updatedHash,updated,'password must be stored hashed only');
    const invalidated=await api('GET','/api/auth/me',undefined,targetSession.token);
    assert.equal(invalidated.user,null,'password change must revoke earlier sessions');
    const oldLogin=await api('POST','/api/auth/login',{phone:'01000008702',password:original});
    assert.equal(oldLogin.status,401,'previous password must not work');
    const newLogin=await api('POST','/api/auth/login',{phone:'01000008702',password:updated});
    assert.equal(newLogin.status,200,'new password grants access');
    const adminStillValid=await api('GET','/api/auth/me',undefined,adminToken);
    assert.equal(adminStillValid.user?.role,'admin','reset must not revoke admin session');
    assert.equal((db.native.prepare('SELECT COUNT(*) c FROM app_users').get() as any).c,3);
  }finally{db.close();}
});