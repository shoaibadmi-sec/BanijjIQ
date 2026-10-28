import type { SherDatabase } from '../../db/types.js';
import { getSetupStatus, login, logout, me, setupAdmin, type LoginInput, type SetupAdminInput } from './service.js';

async function readBody<T>(request:Request):Promise<T>{ try{return await request.json() as T;}catch{throw new Error('Invalid JSON body');} }

export async function handlePublicAuthRoute(db:SherDatabase,request:Request,path:string):Promise<Response|null>{
  if(path==='/api/setup/status'&&request.method==='GET')return getSetupStatus(db);
  if(path==='/api/setup/admin'&&request.method==='POST')return setupAdmin(db,await readBody<SetupAdminInput>(request));
  if(path==='/api/auth/login'&&request.method==='POST')return login(db,await readBody<LoginInput>(request));
  if(path==='/api/auth/me'&&request.method==='GET')return me(db,request);
  if(path==='/api/auth/logout'&&request.method==='POST')return logout(db,request);
  return null;
}
