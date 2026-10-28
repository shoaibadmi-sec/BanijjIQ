import type { SherDatabase } from '../../db/types.js';
import { authError, authJson } from './http.js';
import { buildClientUser } from './permissions.js';
import type { AuthUser } from './types.js';

export type SetupAdminInput = { fullName?: string; phone?: string; password?: string };
export type LoginInput = { phone?: string; password?: string };

function cleanText(value: unknown): string { return String(value ?? '').trim(); }
function bytesToBase64(bytes: Uint8Array): string { let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value:string):Uint8Array { const binary=atob(value); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i); return bytes; }
async function sha256(value:string):Promise<string>{ const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)); return bytesToBase64(new Uint8Array(digest)); }

export async function hashPassword(password:string,saltBase64?:string):Promise<{hash:string;salt:string}>{
  const salt=saltBase64?base64ToBytes(saltBase64):crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return {hash:bytesToBase64(new Uint8Array(bits)),salt:bytesToBase64(salt)};
}

function publicUser(row:{user_id:string;full_name:string;phone:string;role:string;status:string}):AuthUser{
  return {userId:row.user_id,fullName:row.full_name,phone:row.phone,role:row.role,status:row.status};
}

export async function getSetupStatus(db:SherDatabase):Promise<Response>{
  const row=await db.prepare(`SELECT COUNT(*) AS total FROM app_users WHERE status = 'Active'`).first<{total:number}>();
  return authJson({ok:true,setupRequired:Number(row?.total??0)===0});
}

export async function setupAdmin(db:SherDatabase,input:SetupAdminInput):Promise<Response>{
  const existing=await db.prepare(`SELECT COUNT(*) AS total FROM app_users`).first<{total:number}>();
  if(Number(existing?.total??0)>0)return authError('Setup already completed',409);
  const fullName=cleanText(input.fullName)||'Admin',phone=cleanText(input.phone),password=String(input.password??'');
  if(!phone)return authError('Phone number is required');
  if(password.length<6)return authError('Password must be at least 6 characters');
  const userId=crypto.randomUUID(),hashed=await hashPassword(password);
  await db.prepare(`INSERT INTO app_users (user_id, full_name, phone, password_hash, password_salt, role, status, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, 'admin', 'Active', datetime('now'), datetime('now'), 'Initial Setup')`).bind(userId,fullName,phone,hashed.hash,hashed.salt).run();
  await db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, note) VALUES (?, 'SETUP_ADMIN', 'USER', ?, 'Initial admin created')`).bind(userId,userId).run();
  return createSession(db,publicUser({user_id:userId,full_name:fullName,phone,role:'admin',status:'Active'}));
}

async function createSession(db:SherDatabase,user:AuthUser):Promise<Response>{
  const token=crypto.randomUUID()+'.'+crypto.randomUUID(),tokenHash=await sha256(token),sessionId=crypto.randomUUID();
  const timeoutRow=await db.prepare(`SELECT setting_value FROM app_settings WHERE setting_key='Session Timeout Hours' LIMIT 1`).first<{setting_value:string}>();
  const parsedHours=Number(timeoutRow?.setting_value||12),timeoutHours=Number.isFinite(parsedHours)&&parsedHours>0?Math.min(parsedHours,24*30):12;
  await db.prepare(`INSERT INTO auth_sessions (session_id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), datetime('now', ?))`).bind(sessionId,user.userId,tokenHash,`+${timeoutHours} hours`).run();
  await db.prepare(`UPDATE app_users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`).bind(user.userId).run();
  return authJson({ok:true,token,user:await buildClientUser(db,user)});
}

export async function login(db:SherDatabase,input:LoginInput):Promise<Response>{
  const phone=cleanText(input.phone),password=String(input.password??'');
  if(!phone||!password)return authError('Phone and password are required');
  const row=await db.prepare(`SELECT user_id, full_name, phone, password_hash, password_salt, role, status FROM app_users WHERE phone = ? LIMIT 1`).bind(phone).first<{user_id:string;full_name:string;phone:string;password_hash:string;password_salt:string;role:string;status:string}>();
  if(!row||row.status!=='Active')return authError('Invalid phone or password',401);
  const hashed=await hashPassword(password,row.password_salt); if(hashed.hash!==row.password_hash)return authError('Invalid phone or password',401);
  return createSession(db,publicUser(row));
}

export async function getAuthenticatedUser(db:SherDatabase,request:Request):Promise<AuthUser|null>{
  const header=request.headers.get('authorization')||'',token=header.startsWith('Bearer ')?header.slice(7).trim():''; if(!token)return null;
  const tokenHash=await sha256(token);
  const row=await db.prepare(`SELECT u.user_id, u.full_name, u.phone, u.role, u.status FROM auth_sessions s JOIN app_users u ON u.user_id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now') AND u.status = 'Active' LIMIT 1`).bind(tokenHash).first<{user_id:string;full_name:string;phone:string;role:string;status:string}>();
  return row?publicUser(row):null;
}

export async function requireUser(db:SherDatabase,request:Request):Promise<AuthUser|Response>{ const user=await getAuthenticatedUser(db,request); return user??authError('Login required',401); }
export async function me(db:SherDatabase,request:Request):Promise<Response>{ const user=await getAuthenticatedUser(db,request); return authJson({ok:true,user:user?await buildClientUser(db,user):null}); }
export async function logout(db:SherDatabase,request:Request):Promise<Response>{
  const header=request.headers.get('authorization')||'',token=header.startsWith('Bearer ')?header.slice(7).trim():'';
  if(token){const tokenHash=await sha256(token);await db.prepare(`UPDATE auth_sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL`).bind(tokenHash).run();}
  return authJson({ok:true});
}
