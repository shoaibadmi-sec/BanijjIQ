import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

// Characterization of existing RBAC, last-admin and session-revocation behavior.
// All state is held in memory; no Cloudflare credentials or remote database.
test('Phase 8A3B3 employee edit/status use real DB, revoke sessions and preserve last administrator',async()=>{
  const db=new SqliteDatabase(':memory:');
  try{
    runMigrations(db.native,resolve('migrations'));
    const api=async(method:string,path:string,body?:unknown,token='')=>{
      const headers:Record<string,string>={'content-type':'application/json'};
      if(token)headers.authorization='Bearer '+token;
      const res=await handleApiRequest(new Request('https://isolated.invalid'+path,{
        method,headers,body:body===undefined?undefined:JSON.stringify(body)
      }),db);
      return {status:res.status,...await res.json() as Record<string,any>};
    };
    const owner=await api('POST','/api/setup/admin',{
      fullName:'Local Admin',phone:'01000008501',password:'test-only-owner-password-2026'
    });
    assert.equal(owner.status,200);const admin=owner.token as string;
    const role=await api('POST','/api/roles',{
      name:'StockViewer',permissions:{products:{view:true,delete:'disabled',backdate:'disabled'}}
    },admin);
    assert.equal(role.status,200);
    const staffPassword='test-only-staff-password-2026';
    const created=await api('POST','/api/users',{
      name:'Stock Employee',mobile:'01000008502',role:'StockViewer',password:staffPassword
    },admin);
    assert.equal(created.status,200);const staffId=created.id as string;
    const staffLogin=await api('POST','/api/auth/login',{
      phone:'01000008502',password:staffPassword
    });
    assert.equal(staffLogin.status,200);const staffToken=staffLogin.token as string;
    const forbidden=await api('PUT','/api/users/'+staffId,{
      name:'Escalated Editor',mobile:'01000008502',role:'StockViewer'
    },staffToken);
    assert.equal(forbidden.status,403);
    const forbiddenStatus=await api('PUT','/api/users/'+staffId+'/status',
      {status:'Inactive'},staffToken);
    assert.equal(forbiddenStatus.status,403);
    const edited=await api('PUT','/api/users/'+staffId,{
      name:'Updated Employee',mobile:'01000008503',role:'StockViewer'
    },admin);
    assert.equal(edited.status,200,JSON.stringify(edited));
    const stored=db.native.prepare('SELECT full_name,phone,role,status FROM app_users WHERE user_id=?')
      .get(staffId) as any;
    assert.deepEqual(stored,{
      full_name:'Updated Employee',phone:'01000008503',role:'StockViewer',status:'Active'
    });
    const obsoleteSession=await api('GET','/api/auth/me',undefined,staffToken);
    assert.equal(obsoleteSession.user,null,'profile edit must revoke existing staff sessions');
    const relogin=await api('POST','/api/auth/login',{
      phone:'01000008503',password:staffPassword
    });
    assert.equal(relogin.status,200);
    const deactivate=await api('PUT','/api/users/'+staffId+'/status',
      {status:'Inactive'},admin);
    assert.equal(deactivate.status,200);
    assert.equal(deactivate.status===200&&deactivate.status,200);
    assert.equal((db.native.prepare('SELECT status FROM app_users WHERE user_id=?').get(staffId) as any).status,'Inactive');
    const revoked=await api('GET','/api/auth/me',undefined,relogin.token);
    assert.equal(revoked.user,null,'deactivation must revoke the new session');
    const blockedLogin=await api('POST','/api/auth/login',{
      phone:'01000008503',password:staffPassword
    });
    assert.equal(blockedLogin.status,401);
    const reactivate=await api('PUT','/api/users/'+staffId+'/status',{status:'Active'},admin);
    assert.equal(reactivate.status,200);
    const activeLogin=await api('POST','/api/auth/login',{
      phone:'01000008503',password:staffPassword
    });
    assert.equal(activeLogin.status,200,'reactivated employee can sign in');
    const ownerId=owner.user?.userId as string;
    assert.ok(ownerId);
    const lastAdminStatus=await api('PUT','/api/users/'+ownerId+'/status',{status:'Inactive'},admin);
    assert.equal(lastAdminStatus.status,400,'last administrator must remain active');
    const lastAdminRole=await api('PUT','/api/users/'+ownerId,{
      name:'Local Admin',mobile:'01000008501',role:'StockViewer'
    },admin);
    assert.equal(lastAdminRole.status,400,'last administrator must retain admin role');
    assert.equal((db.native.prepare("SELECT COUNT(*) total FROM app_users WHERE role='admin' AND status='Active'").get() as any).total,1);
    const users=await api('GET','/api/users',undefined,admin);
    assert.equal(users.users.find((u:any)=>u.id===staffId)?.status,'Active');
    assert.equal(users.users.find((u:any)=>u.id===staffId)?.name,'Updated Employee');
  }finally{db.close();}
});