import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {SqliteDatabase} from '../server/db/sqlite.ts';
import {runMigrations} from '../server/db/migrate.ts';
import {handleApiRequest} from '../server/core/handler.ts';

test('G2-H split refund endpoints authorize Sales Returns, not ordinary sales posting',async()=>{
 const db=new SqliteDatabase(':memory:');
 try{
  runMigrations(db.native,resolve('migrations'));
  for(const [role,perms] of [
    ['return-cashier',{returns:{view:true,add:true}}],
    ['sale-only',{sales:{view:true,add:true}}]
  ] as const){
    db.native.prepare('INSERT INTO app_roles(role_name,permissions_json) VALUES(?,?)')
      .run(role,JSON.stringify(perms));
    db.native.prepare("INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_by) VALUES (?,?,?,'fixture','fixture',?,'Active','Fixture')")
      .run('USER-'+role,role,role==='return-cashier'?'01000007777':'01000007778',role);
    const token='token-'+role;
    db.native.prepare("INSERT INTO auth_sessions(session_id,user_id,token_hash,expires_at) VALUES (?,?,?,datetime('now','+2 hours'))")
      .run('AUTH-'+role,'USER-'+role,createHash('sha256').update(token).digest('base64'));
  }
  const request=async(role:string,method:'GET'|'POST')=>{
    const response=await handleApiRequest(new Request(
      'https://isolated.test/api/sales-management/NO-SUCH-INVOICE/split-reversal',{
        method,headers:{authorization:'Bearer token-'+role,'content-type':'application/json'},
        ...(method==='POST'?{body:JSON.stringify({reason:'Customer approved original-source reversal'})}:{})
      }),db);
    return {status:response.status,body:await response.json() as Record<string,unknown>};
  };
  assert.equal((await request('sale-only','GET')).status,403);
  assert.equal((await request('sale-only','POST')).status,403);
  assert.equal((await request('return-cashier','GET')).status,404,'returns.view reaches source preview');
  const post=await request('return-cashier','POST');
  assert.equal(post.status,409,'returns.add reaches source check; missing invoice cannot post');
  assert.equal((db.native.prepare('SELECT COUNT(*) n FROM sales_returns').get() as any).n,0);
 }finally{db.close();}
});
