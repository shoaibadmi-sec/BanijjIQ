import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('Phase 8: two assigned custom roles grant only their active union, and updates revoke sessions',async()=>{
  const db=new SqliteDatabase(':memory:');
  const api=async(method:string,path:string,token='',body?:unknown)=>{
    const res=await handleApiRequest(new Request('http://local.test'+path,{
      method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
      body:body===undefined?undefined:JSON.stringify(body)
    }),db);
    return {...await res.json() as Record<string,any>,status:res.status};
  };
  try{
    runMigrations(db.native,resolve('migrations'));
    const admin=await api('POST','/api/setup/admin','',{
      fullName:'Roles Owner',phone:'01000008601',password:'MultiRoleAdmin2026!'
    });
    assert.equal(admin.status,200,JSON.stringify(admin));
    const token=admin.token as string;
    const products=await api('POST','/api/roles',token,{
      name:'StockViewer',permissions:{products:{view:true}}
    });
    const reports=await api('POST','/api/roles',token,{
      name:'ReportViewer',permissions:{reports:{view:true}}
    });
    assert.equal(products.status,200);
    assert.equal(reports.status,200);
    const person=await api('POST','/api/users',token,{
      name:'Two Role Employee',mobile:'01000008602',password:'MultiRoleStaff2026!',
      roleIds:['StockViewer','ReportViewer']
    });
    assert.equal(person.status,200,JSON.stringify(person));
    const users=await api('GET','/api/users',token);
    const record=users.users.find((x:any)=>x.id===person.id);
    assert.deepEqual(record.roleIds,['StockViewer','ReportViewer']);
    assert.equal(record.role,'StockViewer');
    const login=await api('POST','/api/auth/login','',{
      phone:'01000008602',password:'MultiRoleStaff2026!'
    });
    assert.equal(login.status,200,JSON.stringify(login));
    const staff=login.token as string;
    const first=await api('GET','/api/auth/me',staff);
    assert.equal(first.user.allowedModules.includes('products'),true);
    assert.equal(first.user.allowedModules.includes('reports'),true);
    assert.equal((await api('GET','/api/reports/v2/catalog',staff)).status,200);

    const invalid=await api('PUT','/api/users/'+person.id,token,{
      name:'Must Not Change',mobile:'01000008602',roleIds:['StockViewer','UnknownRole']
    });
    assert.equal(invalid.status,400,JSON.stringify(invalid));
    assert.equal((await api('GET','/api/auth/me',staff)).user.userId,person.id,
      'rejected changes must not revoke sessions');
    assert.deepEqual((await api('GET','/api/users',token)).users
      .find((x:any)=>x.id===person.id).roleIds,['StockViewer','ReportViewer']);

    const update=await api('PUT','/api/users/'+person.id,token,{
      name:'Two Role Employee',mobile:'01000008602',roleIds:['StockViewer']
    });
    assert.equal(update.status,200,JSON.stringify(update));
    assert.equal((await api('GET','/api/auth/me',staff)).user,null);
    const relogin=await api('POST','/api/auth/login','',{
      phone:'01000008602',password:'MultiRoleStaff2026!'
    });
    assert.equal(relogin.status,200);
    const after=await api('GET','/api/auth/me',relogin.token);
    assert.deepEqual(after.user.allowedModules,['products']);
    assert.equal((await api('GET','/api/reports/v2/catalog',relogin.token)).status,403);
    assert.deepEqual((await api('GET','/api/users',token)).users
      .find((x:any)=>x.id===person.id).roleIds,['StockViewer']);

    const deactivate=await api('PUT','/api/roles/'+products.id+'/status',token,{status:'Inactive'});
    assert.equal(deactivate.status,200);
    assert.deepEqual((await api('GET','/api/auth/me',relogin.token)).user.allowedModules,[]);
  }finally{db.close();}
});
