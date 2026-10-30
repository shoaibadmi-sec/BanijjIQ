import type { SherDatabase, SqlPreparedStatement } from '../../db/types.js';
import type { AuthUser, RolePermissions } from '../auth/types.js';
import { hashPassword } from '../auth/service.js';
import {
  DELETE_WINDOW_OPTIONS,
  PERMISSION_MODULES,
  mayAssignCustomRole,
  requireManagementDelete,
  requireModulePermission,
  sanitizePermissions
} from '../auth/permissions.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: jsonHeaders }); }
function error(message: string, status = 400): Response { return json({ ok: false, error: message }, status); }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }

function displayRoleName(role:string):string{return role==='admin'?'Administrator':role}
async function countActiveAdmins(db:SherDatabase):Promise<number>{
  const r=await db.prepare(`SELECT COUNT(*) total FROM app_users WHERE role='admin' AND status='Active'`).first<{total:number}>();
  return Number(r?.total||0);
}
function requireAdministratorForAdminTarget(actor:AuthUser,targetRole:string):Response|null{
  return targetRole==='admin' && actor.role!=='admin'
    ? error('Only an Administrator can manage an Administrator account.',403)
    : null;
}
async function validAssignableRole(db:SherDatabase,role:string):Promise<boolean>{
  if(role==='admin')return true;
  return !!(await db.prepare(`SELECT 1 ok FROM app_roles WHERE role_name=? LIMIT 1`).bind(role).first<any>());
}
export async function getUsersBootstrapRoute(db:SherDatabase,user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'users','view');if(denied)return denied;
  const [ur,rr]=await Promise.all([
    db.prepare(`SELECT user_id,full_name,phone,role,status,created_by,created_at,last_login_at FROM app_users ORDER BY full_name COLLATE NOCASE`).all<any>(),
    db.prepare(`SELECT role_name FROM app_roles WHERE status='Active' ORDER BY role_name COLLATE NOCASE`).all<any>()
  ]);
  return json({ok:true,
    users:(ur.results||[]).map((u:any)=>({id:u.user_id,name:u.full_name,mobile:u.phone,role:u.role,roleLabel:displayRoleName(u.role),status:u.status,createdBy:u.created_by||'',createdAt:u.created_at||'',lastLogin:u.last_login_at||''})),
    roles:(rr.results||[]).map((r:any)=>({name:r.role_name,label:r.role_name})),
    canAssignAdministrator:user.role==='admin'
  });
}
export async function createManagedUserRoute(db:SherDatabase,input:any,actor:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,actor,'users','add');if(denied)return denied;
  const name=cleanText(input.name),mobile=cleanText(input.mobile),role=cleanText(input.role),password=String(input.password||'');
  if(!name)return error('Full name is required.');if(!mobile)return error('Mobile number is required.');if(!role)return error('Choose a role.');
  if(role==='admin'&&actor.role!=='admin')return error('Only an Administrator can assign the Administrator role.',403);
  if(password.length<6)return error('Password must be at least 6 characters.');
  if(!(await validAssignableRole(db,role)))return error('Role not found.');
  if(!(await mayAssignCustomRole(db,actor,role)))return error('You cannot assign a role beyond your own permissions.',403);
  if(await db.prepare(`SELECT 1 ok FROM app_users WHERE phone=? LIMIT 1`).bind(mobile).first<any>())return error('A user with this mobile number already exists.');
  const id=crypto.randomUUID(),hashed=await hashPassword(password);
  await db.prepare(`INSERT INTO app_users(user_id,full_name,phone,password_hash,password_salt,role,status,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,'Active',datetime('now'),datetime('now'),?)`)
    .bind(id,name,mobile,hashed.hash,hashed.salt,role,actor.fullName||actor.phone).run();
  await db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'CREATE_USER','USER',?,?)`).bind(actor.userId,id,`Created ${name}`).run();
  return json({ok:true,id});
}
export async function updateManagedUserRoute(db:SherDatabase,id:string,input:any,actor:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,actor,'users','edit');if(denied)return denied;
  const existing=await db.prepare(`SELECT user_id,full_name,phone,role,status FROM app_users WHERE user_id=? LIMIT 1`).bind(id).first<any>();if(!existing)return error('User not found.',404);
  const adminDenied=requireAdministratorForAdminTarget(actor,existing.role);if(adminDenied)return adminDenied;
  const name=cleanText(input.name),mobile=cleanText(input.mobile),role=cleanText(input.role);
  if(!name)return error('Full name is required.');if(!mobile)return error('Mobile number is required.');if(!role)return error('Choose a role.');
  if(role==='admin'&&existing.role!=='admin'&&actor.role!=='admin')return error('Only an Administrator can assign the Administrator role.',403);
  if(!(await validAssignableRole(db,role)))return error('Role not found.');
  if(!(await mayAssignCustomRole(db,actor,role)))return error('You cannot assign a role beyond your own permissions.',403);
  if(await db.prepare(`SELECT 1 ok FROM app_users WHERE phone=? AND user_id<>? LIMIT 1`).bind(mobile,id).first<any>())return error('A user with this mobile number already exists.');
  if(existing.role==='admin'&&role!=='admin'&&existing.status==='Active'&&await countActiveAdmins(db)<=1)return error('At least one active Administrator account must remain — make someone else an Administrator before changing this one’s role.');
  await db.prepare(`UPDATE app_users SET full_name=?,phone=?,role=?,updated_at=datetime('now') WHERE user_id=?`).bind(name,mobile,role,id).run();
  await db.prepare(`UPDATE auth_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL`).bind(id).run();
  return json({ok:true,id});
}
export async function resetManagedUserPasswordRoute(db:SherDatabase,id:string,input:any,actor:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,actor,'users','edit');if(denied)return denied;
  const target=await db.prepare(`SELECT role FROM app_users WHERE user_id=?`).bind(id).first<{role:string}>();if(!target)return error('User not found.',404);
  const adminDenied=requireAdministratorForAdminTarget(actor,target.role);if(adminDenied)return adminDenied;
  const password=String(input.newPassword||'');if(password.length<6)return error('Password must be at least 6 characters.');
  const hashed=await hashPassword(password);
  await db.prepare(`UPDATE app_users SET password_hash=?,password_salt=?,updated_at=datetime('now') WHERE user_id=?`).bind(hashed.hash,hashed.salt,id).run();
  await db.prepare(`UPDATE auth_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL`).bind(id).run();
  return json({ok:true,id});
}
export async function setManagedUserStatusRoute(db:SherDatabase,id:string,statusRaw:string,actor:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,actor,'users','edit');if(denied)return denied;
  const row=await db.prepare(`SELECT role,status FROM app_users WHERE user_id=?`).bind(id).first<any>();if(!row)return error('User not found.',404);
  const adminDenied=requireAdministratorForAdminTarget(actor,row.role);if(adminDenied)return adminDenied;
  const status=statusRaw==='Active'?'Active':'Inactive';
  if(status==='Inactive'&&row.role==='admin'&&row.status==='Active'&&await countActiveAdmins(db)<=1)return error('At least one active Administrator account must remain.');
  await db.prepare(`UPDATE app_users SET status=?,updated_at=datetime('now') WHERE user_id=?`).bind(status,id).run();
  if(status==='Inactive')await db.prepare(`UPDATE auth_sessions SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL`).bind(id).run();
  return json({ok:true,id,status});
}
export async function deleteManagedUserRoute(db:SherDatabase,id:string,actor:AuthUser):Promise<Response>{
  const denied=await requireManagementDelete(db,actor,'users');if(denied)return denied;
  if(actor.userId===id)return error('You cannot delete your own account while logged in.');
  const row=await db.prepare(`SELECT role,status FROM app_users WHERE user_id=?`).bind(id).first<any>();if(!row)return error('User not found.',404);
  const adminDenied=requireAdministratorForAdminTarget(actor,row.role);if(adminDenied)return adminDenied;
  if(row.role==='admin'&&row.status==='Active'&&await countActiveAdmins(db)<=1)return error('At least one active Administrator account must remain and cannot be deleted.');
  await db.batch([
    db.prepare(`DELETE FROM auth_sessions WHERE user_id=?`).bind(id),
    db.prepare(`UPDATE audit_logs SET user_id=NULL WHERE user_id=?`).bind(id),
    db.prepare(`DELETE FROM app_users WHERE user_id=?`).bind(id)
  ]);
  return json({ok:true,id});
}
export async function getRolesBootstrapRoute(db:SherDatabase,user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'roles','view');if(denied)return denied;
  const rr=await db.prepare(`SELECT role_id,role_name,allowed_modules,permissions_json,status,created_at FROM app_roles ORDER BY role_name COLLATE NOCASE`).all<any>();
  return json({ok:true,roles:(rr.results||[]).map((r:any)=>{let p:RolePermissions={};try{p=sanitizePermissions(JSON.parse(r.permissions_json||'{}'))}catch{}return{id:r.role_id,name:r.role_name,allowedModules:String(r.allowed_modules||'').split(',').filter(Boolean),permissions:p,status:r.status,createdAt:r.created_at||''}}),moduleOptions:PERMISSION_MODULES,deleteWindowOptions:DELETE_WINDOW_OPTIONS});
}
export async function createManagedRoleRoute(db:SherDatabase,input:any,user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'roles','add');if(denied)return denied;
  const name=cleanText(input.name);if(!name)return error('Role name is required.');if(name.toLowerCase()==='administrator'||name.toLowerCase()==='admin')return error('"Administrator" is a built-in role and can’t be created here.');
  if(await db.prepare(`SELECT 1 ok FROM app_roles WHERE lower(role_name)=lower(?) LIMIT 1`).bind(name).first<any>())return error('A role with this name already exists.');
  const permissions=sanitizePermissions(input.permissions),allowed=Object.keys(permissions).filter(k=>permissions[k]?.view),id=crypto.randomUUID();
  await db.prepare(`INSERT INTO app_roles(role_id,role_name,allowed_modules,permissions_json,status,created_at,updated_at) VALUES (?,?,?,?,'Active',datetime('now'),datetime('now'))`).bind(id,name,allowed.join(','),JSON.stringify(permissions)).run();
  return json({ok:true,id});
}
export async function updateManagedRoleRoute(db:SherDatabase,id:string,input:any,user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'roles','edit');if(denied)return denied;
  const row=await db.prepare(`SELECT role_name FROM app_roles WHERE role_id=?`).bind(id).first<any>();if(!row)return error('Role not found.',404);
  const name=cleanText(input.name);if(!name)return error('Role name is required.');if(name.toLowerCase()==='administrator'||name.toLowerCase()==='admin')return error('"Administrator" is a built-in role and can’t be renamed to that.');
  if(await db.prepare(`SELECT 1 ok FROM app_roles WHERE lower(role_name)=lower(?) AND role_id<>? LIMIT 1`).bind(name,id).first<any>())return error('A role with this name already exists.');
  const permissions=sanitizePermissions(input.permissions),allowed=Object.keys(permissions).filter(k=>permissions[k]?.view),oldName=String(row.role_name);
  await db.batch([
    db.prepare(`UPDATE app_roles SET role_name=?,allowed_modules=?,permissions_json=?,updated_at=datetime('now') WHERE role_id=?`).bind(name,allowed.join(','),JSON.stringify(permissions),id),
    db.prepare(`UPDATE app_users SET role=?,updated_at=datetime('now') WHERE role=?`).bind(name,oldName),
    db.prepare(`UPDATE auth_sessions SET revoked_at=datetime('now') WHERE user_id IN (SELECT user_id FROM app_users WHERE role=?) AND revoked_at IS NULL`).bind(name)
  ]);
  return json({ok:true,id});
}
export async function setManagedRoleStatusRoute(db:SherDatabase,id:string,statusRaw:string,user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'roles','edit');if(denied)return denied;
  if(!(await db.prepare(`SELECT 1 ok FROM app_roles WHERE role_id=?`).bind(id).first<any>()))return error('Role not found.',404);
  const status=statusRaw==='Active'?'Active':'Inactive';await db.prepare(`UPDATE app_roles SET status=?,updated_at=datetime('now') WHERE role_id=?`).bind(status,id).run();return json({ok:true,id,status});
}
export async function deleteManagedRoleRoute(db:SherDatabase,id:string,user:AuthUser):Promise<Response>{
  const denied=await requireManagementDelete(db,user,'roles');if(denied)return denied;
  const row=await db.prepare(`SELECT role_name FROM app_roles WHERE role_id=?`).bind(id).first<any>();if(!row)return error('Role not found.',404);
  if(await db.prepare(`SELECT 1 ok FROM app_users WHERE role=? LIMIT 1`).bind(row.role_name).first<any>())return error('This role is assigned to one or more users and can’t be deleted. Deactivate it instead, or reassign those users first.');
  await db.prepare(`DELETE FROM app_roles WHERE role_id=?`).bind(id).run();return json({ok:true,id});
}

const SYSTEM_BACKUP_TABLES = [
  'product_categories','product_brands','product_units','products','stock_lots','stock_movements','stock_expiry_batches','product_serials',
  'purchases','purchase_items','purchase_plans','purchase_plan_items','purchase_plan_orders','purchase_plan_order_items',
  'suppliers','supplier_ledger','bank_accounts','purchase_returns','purchase_return_items',
  'invoice_edit_logs','cash_sessions','cash_book','bank_book','customers','customer_ledger','vendors','vendor_ledger',
  'sales','sale_items','sale_item_lots','sale_item_tracking','warranty_records','warranty_claims','warranty_replacements','supplier_warranty_rmas','supplier_warranty_rma_received_items','supplier_warranty_rma_financials','vendor_sourcing','sales_returns','sales_return_items','app_settings',
  'expense_categories','expenses','bank_transfers','expense_payees','finance_persons','finance_transactions',
  'app_roles','app_users','audit_logs','vendor_returns','vendor_issues','vendor_returns_received'
] as const;
function requireSystemAdministrator(user:AuthUser):Response|null{return user.role==='admin'?null:error('Administrator permission is required for System tools.',403)}
export async function getSystemOverviewRoute(db:SherDatabase,user:AuthUser):Promise<Response>{
  const denied=requireSystemAdministrator(user);if(denied)return denied;
  const tableRows:Array<{table:string;rows:number}>=[];let totalRows=0;
  for(const table of SYSTEM_BACKUP_TABLES){const r=await db.prepare(`SELECT COUNT(*) total FROM ${table}`).first<{total:number}>();const rows=Number(r?.total||0);tableRows.push({table,rows});totalRows+=rows;}
  const [users,sessions,audits,lastAudit]=await Promise.all([
    db.prepare(`SELECT COUNT(*) total FROM app_users WHERE status='Active'`).first<{total:number}>(),
    db.prepare(`SELECT COUNT(*) total FROM auth_sessions WHERE revoked_at IS NULL AND expires_at>datetime('now')`).first<{total:number}>(),
    db.prepare(`SELECT COUNT(*) total FROM audit_logs`).first<{total:number}>(),
    db.prepare(`SELECT created_at FROM audit_logs ORDER BY id DESC LIMIT 1`).first<{created_at:string}>()
  ]);
  return json({ok:true,overview:{tableCount:SYSTEM_BACKUP_TABLES.length,totalRows,tableRows,activeUsers:Number(users?.total||0),activeSessions:Number(sessions?.total||0),auditEntries:Number(audits?.total||0),lastAuditAt:lastAudit?.created_at||''}});
}
export async function createSystemBackupRoute(db:SherDatabase,user:AuthUser):Promise<Response>{
  const denied=requireSystemAdministrator(user);if(denied)return denied;
  const tables:Record<string,Array<Record<string,unknown>>>={};
  for(const table of SYSTEM_BACKUP_TABLES){const r=await db.prepare(`SELECT * FROM ${table}`).all<any>();tables[table]=(r.results||[]) as Array<Record<string,unknown>>;}
  await db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'DOWNLOAD_BACKUP','SYSTEM','DATABASE','Downloaded D1 JSON backup')`).bind(user.userId).run();
  return json({ok:true,backup:{format:'SherERP-D1-Backup',version:1,createdAt:new Date().toISOString(),app:'SherERP',tables}});
}
export async function restoreSystemBackupRoute(db:SherDatabase,input:any,user:AuthUser):Promise<Response>{
  const denied=requireSystemAdministrator(user);if(denied)return denied;
  if(cleanText(input?.confirmation)!=='RESTORE')return error('Type RESTORE exactly to confirm.');
  const backup=input?.backup;
  if(!backup||backup.format!=='SherERP-D1-Backup'||backup.version!==1||!backup.tables||typeof backup.tables!=='object')return error('Invalid SherERP backup file.');
  const supplied=Object.keys(backup.tables);const invalid=supplied.filter(t=>!SYSTEM_BACKUP_TABLES.includes(t as any));
  if(invalid.length)return error(`Backup contains unsupported table(s): ${invalid.join(', ')}`);
  const schemas=new Map<string,string[]>();
  for(const table of SYSTEM_BACKUP_TABLES){
    const info=await db.prepare(`PRAGMA table_info(${table})`).all<any>();const columns=(info.results||[]).map((r:any)=>String(r.name));
    if(!columns.length)return error(`Could not inspect table ${table}.`);schemas.set(table,columns);
    const rows=Array.isArray(backup.tables[table])?backup.tables[table]:[];
    for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row))return error(`Invalid row found in ${table}.`);const bad=Object.keys(row).filter(k=>!columns.includes(k));if(bad.length)return error(`Backup column mismatch in ${table}: ${bad.join(', ')}`);}
  }
  for(const table of [...SYSTEM_BACKUP_TABLES].reverse())await db.prepare(`DELETE FROM ${table}`).run();
  let restoredRows=0,restoredTables=0;
  for(const table of SYSTEM_BACKUP_TABLES){
    const rows=Array.isArray(backup.tables[table])?backup.tables[table]:[];if(!rows.length)continue;restoredTables++;
    const allowed=schemas.get(table)||[];const statements:SqlPreparedStatement[]=[];
    for(const row of rows){const keys=Object.keys(row).filter(k=>allowed.includes(k));if(!keys.length)continue;const sql=`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`;statements.push(db.prepare(sql).bind(...keys.map(k=>(row as any)[k] ?? null)));restoredRows++;if(statements.length>=50)await db.batch(statements.splice(0,statements.length));}
    if(statements.length)await db.batch(statements);
  }
  await db.prepare(`DELETE FROM auth_sessions`).run();
  return json({ok:true,restoredTables,restoredRows,signInAgain:true});
}
export async function getAuditLogRoute(db:SherDatabase,url:URL,user:AuthUser):Promise<Response>{
  const denied=requireSystemAdministrator(user);if(denied)return denied;
  const dateFrom=cleanText(url.searchParams.get('dateFrom')),dateTo=cleanText(url.searchParams.get('dateTo')),action=cleanText(url.searchParams.get('action')),entityType=cleanText(url.searchParams.get('entityType')),q=cleanText(url.searchParams.get('q')).toLowerCase();
  const where:string[]=['1=1'];const binds:any[]=[];
  if(dateFrom){where.push(`substr(a.created_at,1,10)>=?`);binds.push(dateFrom)}if(dateTo){where.push(`substr(a.created_at,1,10)<=?`);binds.push(dateTo)}if(action){where.push(`a.action=?`);binds.push(action)}if(entityType){where.push(`a.entity_type=?`);binds.push(entityType)}
  if(q){where.push(`(lower(COALESCE(u.full_name,'')) LIKE ? OR lower(COALESCE(a.entity_id,'')) LIKE ? OR lower(COALESCE(a.note,'')) LIKE ? OR lower(a.action) LIKE ?)`);const like=`%${q}%`;binds.push(like,like,like,like)}
  const clause=where.join(' AND ');
  const [rows,total]=await Promise.all([
    db.prepare(`SELECT a.id,a.user_id,u.full_name user_name,a.action,a.entity_type,a.entity_id,a.note,a.created_at FROM audit_logs a LEFT JOIN app_users u ON u.user_id=a.user_id WHERE ${clause} ORDER BY a.id DESC LIMIT 500`).bind(...binds).all<any>(),
    db.prepare(`SELECT COUNT(*) total FROM audit_logs a LEFT JOIN app_users u ON u.user_id=a.user_id WHERE ${clause}`).bind(...binds).first<{total:number}>()
  ]);
  return json({ok:true,total:Number(total?.total||0),rows:(rows.results||[]).map((r:any)=>({id:Number(r.id),userId:r.user_id||'',userName:r.user_name||'',action:r.action||'',entityType:r.entity_type||'',entityId:r.entity_id||'',note:r.note||'',createdAt:r.created_at||''}))});
}

const SETTINGS_EDITABLE_KEYS = new Set([
  'Shop Name','Shop Name Bangla','Shop Description','Address','Phone 1','Phone 2','Email','Currency Symbol','Currency Code','Tax Percent','Default Discount','Low Stock Threshold',
  'Invoice Payment Methods','Invoice Terms','Invoice Payment Terms Days','Invoice Payment Terms Text','Invoice Footer','Invoice Proprietor Name','Invoice Proprietor Paragraph','Invoice Title',
  'Invoice Show Bismillah','Invoice Bismillah Text','Invoice Show Signature','Drive Folder Id','Timezone','Receipt Size','Delete Confirmation Key','Day Book Editable Days','Default Bank Account','Session Timeout Hours','POS Show Purchase Price'
]);
const SETTINGS_NUMERIC_KEYS = new Set(['Tax Percent','Default Discount','Low Stock Threshold','Day Book Editable Days','Session Timeout Hours','Invoice Payment Terms Days']);
const SETTINGS_BOOLEAN_KEYS = new Set(['Invoice Show Bismillah','Invoice Show Signature','POS Show Purchase Price']);
const SETTINGS_JSON_ARRAY_KEYS = new Set(['Invoice Payment Methods','Invoice Terms']);
const SETTINGS_LOGO_MIME = new Set(['image/png','image/jpeg','image/webp','image/gif']);
const SETTINGS_LOGO_MAX_BYTES = 1.5 * 1024 * 1024;
async function readSettingsMap(db: SherDatabase): Promise<Record<string,string>> {const r=await db.prepare(`SELECT setting_key,setting_value FROM app_settings ORDER BY setting_key`).all<any>();const out:Record<string,string>={};for(const row of r.results||[])out[cleanText(row.setting_key)]=String(row.setting_value??'');return out;}
export async function getSettingsBootstrapRoute(db:SherDatabase,user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'settings','view');if(denied)return denied;
  const [settings,banks]=await Promise.all([readSettingsMap(db),db.prepare(`SELECT bank_account_id id, account_name name FROM bank_accounts WHERE status<>'Inactive' ORDER BY account_name COLLATE NOCASE`).all<any>()]);
  return json({ok:true,settings,bankAccounts:(banks.results||[]).map((b:any)=>({id:cleanText(b.id),name:cleanText(b.name)}))});
}
export async function updateSettingsRoute(db:SherDatabase,input:Record<string,unknown>,user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'settings','edit');if(denied)return denied;
  if(!input||typeof input!=='object')return error('No settings data received.');if(input['Shop Name']!==undefined&&!cleanText(input['Shop Name']))return error('Shop Name is required.');if(input['Shop Name Bangla']!==undefined&&!cleanText(input['Shop Name Bangla']))return error('Shop Name (Bangla) is required.');
  const stmts:SqlPreparedStatement[]=[];
  for(const [key,raw] of Object.entries(input)){
    if(!SETTINGS_EDITABLE_KEYS.has(key))continue;let value='';
    if(SETTINGS_NUMERIC_KEYS.has(key)){if(raw!==''&&(!Number.isFinite(Number(raw))||Number(raw)<0))return error(`"${key}" must be a valid non-negative number.`);value=String(Number(raw||0));}
    else if(SETTINGS_BOOLEAN_KEYS.has(key))value=raw===true||String(raw).trim().toLowerCase()==='true'?'true':'false';else value=cleanText(raw);
    if(SETTINGS_JSON_ARRAY_KEYS.has(key)&&value){try{const parsed=JSON.parse(value);if(!Array.isArray(parsed))throw new Error();}catch{return error(`"${key}" must be valid JSON containing an array.`);}}
    if(key==='Default Bank Account'&&value){const exists=await db.prepare(`SELECT 1 ok FROM bank_accounts WHERE bank_account_id=? LIMIT 1`).bind(value).first<any>();if(!exists)return error('Selected default bank account no longer exists.');}
    stmts.push(db.prepare(`INSERT INTO app_settings(setting_key,setting_value) VALUES (?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value`).bind(key,value));
  }
  if(stmts.length)await db.batch(stmts);await db.prepare(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,note) VALUES (?,'UPDATE_SETTINGS','SETTINGS','GENERAL','Settings updated')`).bind(user.userId).run();return json({ok:true});
}
export async function getInvoiceDesignBootstrapRoute(db:SherDatabase,user:AuthUser):Promise<Response>{const denied=await requireModulePermission(db,user,'settings','view');if(denied)return denied;const settings=await readSettingsMap(db);return json({ok:true,settings,logoDataUri:settings['Invoice Logo']||''});}
function base64DecodedByteLength(base64:string):number{const clean=base64.replace(/\s/g,'');const padding=clean.endsWith('==')?2:clean.endsWith('=')?1:0;return Math.max(0,Math.floor(clean.length*3/4)-padding)}
export async function uploadInvoiceLogoRoute(db:SherDatabase,input:{base64Data?:string;mimeType?:string},user:AuthUser):Promise<Response>{
  const denied=await requireModulePermission(db,user,'settings','edit');if(denied)return denied;const base64=String(input.base64Data||'').trim(),mime=cleanText(input.mimeType);
  if(!base64)return error('No image data received.');if(!SETTINGS_LOGO_MIME.has(mime))return error('Logo must be PNG, JPEG, WEBP or GIF.');if(base64DecodedByteLength(base64)>SETTINGS_LOGO_MAX_BYTES)return error('Logo is too large — please use an image under 1.5MB.');if(!/^[A-Za-z0-9+/=\r\n]+$/.test(base64))return error('Could not read the uploaded image.');
  const dataUri=`data:${mime};base64,${base64}`;await db.prepare(`INSERT INTO app_settings(setting_key,setting_value) VALUES ('Invoice Logo',?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value`).bind(dataUri).run();return json({ok:true,dataUri});
}
export async function removeInvoiceLogoRoute(db:SherDatabase,user:AuthUser):Promise<Response>{const denied=await requireModulePermission(db,user,'settings','edit');if(denied)return denied;await db.prepare(`INSERT INTO app_settings(setting_key,setting_value) VALUES ('Invoice Logo','') ON CONFLICT(setting_key) DO UPDATE SET setting_value=''`).run();return json({ok:true});}
