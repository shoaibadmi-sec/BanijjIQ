import type { SherDatabase } from '../../db/types.js';
import { authError } from './http.js';
import type { AuthUser, DeleteWindowCode, ModulePermission, RolePermissions } from './types.js';

export const PERMISSION_MODULES = [
  { key:'dashboard', label:'Dashboard' }, { key:'pos', label:'POS' }, { key:'sales', label:'Sales' },
  { key:'returns', label:'Sales Return' }, { key:'purchase', label:'Purchases' }, { key:'suppliers', label:'Suppliers' },
  { key:'vendors', label:'Vendor Ledger' }, { key:'products', label:'Products' }, { key:'customers', label:'Customers' },
  { key:'bank', label:'Bank Accounts' }, { key:'expense', label:'Expenses' }, { key:'finance', label:'Capital & Loans' },
  { key:'daybook', label:'Day Book' }, { key:'reports', label:'Reports' }, { key:'settings', label:'Settings' },
  { key:'users', label:'Users' }, { key:'roles', label:'Roles' }, { key:'posCost', label:'POS Purchase Price' }
] as const;

export const DELETE_WINDOW_OPTIONS: Array<{key:DeleteWindowCode;label:string}> = [
  {key:'disabled',label:'Disabled'},{key:'same',label:'Same Day'},{key:'1',label:'1 Day'},{key:'3',label:'3 Days'},
  {key:'7',label:'7 Days'},{key:'15',label:'15 Days'},{key:'30',label:'30 Days'},{key:'unlimited',label:'Unlimited'}
];

function normalizePermissionEntry(moduleKey:string, raw:any): ModulePermission {
  const management = moduleKey === 'users' || moduleKey === 'roles';
  const validWindows = new Set(DELETE_WINDOW_OPTIONS.map(x=>x.key));
  const del = management ? (raw?.delete === true || raw?.delete === 'unlimited') : (validWindows.has(raw?.delete) ? raw.delete as DeleteWindowCode : 'disabled');
  return { view:!!raw?.view, add:!!raw?.add, edit:!!raw?.edit, delete:del, backdate:validWindows.has(raw?.backdate) ? raw.backdate : 'unlimited' };
}

export function sanitizePermissions(raw:any): RolePermissions {
  const out:RolePermissions={};
  for(const m of PERMISSION_MODULES){
    if(!raw || typeof raw!=='object' || !raw[m.key]) continue;
    const p=normalizePermissionEntry(m.key,raw[m.key]);
    const hasDelete=(m.key==='users'||m.key==='roles') ? p.delete===true : p.delete!=='disabled';
    if(p.view||p.add||p.edit||hasDelete) out[m.key]=p;
  }
  return out;
}

export async function getUserPermissions(db:SherDatabase,user:AuthUser):Promise<RolePermissions|null>{
  if(user.role==='admin') return null;
  const row=await db.prepare(`SELECT permissions_json FROM app_roles WHERE role_name=? LIMIT 1`).bind(user.role).first<{permissions_json:string}>();
  if(!row) return {};
  try{return sanitizePermissions(JSON.parse(row.permissions_json||'{}'))}catch{return {}}
}

export async function buildClientUser(db:SherDatabase,user:AuthUser):Promise<AuthUser & {allowedModules:string[]|null;permissions:RolePermissions|null}>{
  const permissions=await getUserPermissions(db,user);
  return {...user,allowedModules:permissions===null?null:Object.keys(permissions).filter(k=>permissions[k]?.view),permissions};
}

export async function hasModulePermission(db:SherDatabase,user:AuthUser,moduleKey:string,action:'view'|'add'|'edit'):Promise<boolean>{
  if(user.role==='admin')return true;
  const perms=await getUserPermissions(db,user); return !!perms?.[moduleKey]?.[action];
}

export async function requireModulePermission(db:SherDatabase,user:AuthUser,moduleKey:string,action:'view'|'add'|'edit'):Promise<Response|null>{
  return await hasModulePermission(db,user,moduleKey,action)?null:authError(`You do not have permission to ${action} ${moduleKey}.`,403);
}

export function daysSince(dateRaw:string):number{
  const d=String(dateRaw||'').slice(0,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return Number.POSITIVE_INFINITY;
  const a=new Date(`${d}T00:00:00Z`), b=new Date(`${new Date().toISOString().slice(0,10)}T00:00:00Z`);
  return Math.round((b.getTime()-a.getTime())/86400000);
}

function windowAllows(code:unknown,dateRaw:string):boolean{
  if(code==='unlimited')return true; if(!code||code==='disabled')return false;
  const days=daysSince(dateRaw); if(code==='same')return days===0;
  const n=Number(code); return Number.isFinite(n)&&days>=0&&days<=n;
}

export async function requireManagementDelete(db:SherDatabase,user:AuthUser,moduleKey:'users'|'roles'):Promise<Response|null>{
  if(user.role==='admin')return null;
  const p=(await getUserPermissions(db,user))?.[moduleKey];
  return p&&(p.delete===true||p.delete==='unlimited')?null:authError(`You do not have permission to delete ${moduleKey}.`,403);
}

async function requireDeleteWindow(db:SherDatabase,user:AuthUser,moduleKey:string,dateRaw:string):Promise<Response|null>{
  if(user.role==='admin')return null;
  const p=(await getUserPermissions(db,user))?.[moduleKey];
  return p&&windowAllows(p.delete,dateRaw)?null:authError(`You do not have permission to delete this record (outside the allowed ${moduleKey} delete window, or delete is disabled for your role).`,403);
}

async function resolveDeleteRecordDate(db:SherDatabase,path:string,moduleKey:string):Promise<string>{
  let m:RegExpMatchArray|null;
  if(moduleKey==='sales' && (m=path.match(/^\/api\/sales-management\/([^/]+)(?:\/reverse)?$/))) return (await db.prepare(`SELECT sale_date d FROM sales WHERE invoice_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  if(moduleKey==='purchase' && (m=path.match(/^\/api\/purchases\/([^/]+)$/))) return (await db.prepare(`SELECT purchase_date d FROM purchases WHERE purchase_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  if(moduleKey==='products' && (m=path.match(/^\/api\/products\/([^/]+)$/))) return (await db.prepare(`SELECT substr(created_at,1,10) d FROM products WHERE product_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  if(moduleKey==='customers' && (m=path.match(/^\/api\/customers\/([^/]+)$/))) return (await db.prepare(`SELECT substr(created_at,1,10) d FROM customers WHERE customer_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  if(moduleKey==='customers' && (m=path.match(/^\/api\/customer-payments\/([^/]+)$/))) return (await db.prepare(`SELECT substr(date,1,10) d FROM customer_ledger WHERE ledger_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  if(moduleKey==='suppliers' && (m=path.match(/^\/api\/suppliers\/([^/]+)$/))) return (await db.prepare(`SELECT substr(created_at,1,10) d FROM suppliers WHERE supplier_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  if(moduleKey==='suppliers' && (m=path.match(/^\/api\/supplier-payments\/([^/]+)$/))) return (await db.prepare(`SELECT substr(date,1,10) d FROM supplier_ledger WHERE ledger_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  if(moduleKey==='finance' && (m=path.match(/^\/api\/finance\/transactions\/([^/]+)$/))) return (await db.prepare(`SELECT substr(date,1,10) d FROM finance_transactions WHERE finance_id=?`).bind(decodeURIComponent(m[1])).first<any>())?.d||'';
  return new Date().toISOString().slice(0,10);
}

function permissionRouteInfo(path:string,method:string):{moduleKey:string;action:'view'|'add'|'edit'|'delete'}|null{
  if(path==='/api/bootstrap')return null;
  const rules:Array<[RegExp,string]>=[
    [/^\/api\/settings/,'settings'],[/^\/api\/dashboard$/,'dashboard'],[/^\/api\/reports/,'reports'],[/^\/api\/finance/,'finance'],
    [/^\/api\/daybook/,'daybook'],[/^\/api\/bank/,'bank'],[/^\/api\/expenses/,'expense'],[/^\/api\/expense-/,'expense'],
    [/^\/api\/customers/,'customers'],[/^\/api\/customer-payments/,'customers'],[/^\/api\/sales-returns/,'returns'],
    [/^\/api\/sales-management/,'sales'],[/^\/api\/vendors/,'vendors'],[/^\/api\/pos/,'pos'],[/^\/api\/purchases/,'purchase'],[/^\/api\/purchase-returns/,'purchase'],
    [/^\/api\/suppliers/,'suppliers'],[/^\/api\/supplier-payments/,'suppliers'],[/^\/api\/product-tracking/,'products'],[/^\/api\/products/,'products'],[/^\/api\/categories/,'products'],
    [/^\/api\/brands/,'products'],[/^\/api\/units/,'products'],[/^\/api\/users/,'users'],[/^\/api\/roles/,'roles']
  ];
  const found=rules.find(([re])=>re.test(path)); if(!found)return null;
  let action:'view'|'add'|'edit'|'delete'=method==='GET'?'view':method==='PUT'?'edit':method==='DELETE'?'delete':'add';
  if(/\/reset-password$/.test(path)||/\/status$/.test(path)||/\/adjust-stock$/.test(path)||/\/stock-loss$/.test(path)||/\/cancel$/.test(path)||/\/reverse$/.test(path)||/\/purchases\/planner\/plans\/[^/]+\/(approve|reject)$/.test(path))action='edit';
  if(/^\/api\/sales-management\/[^/]+\/reverse$/.test(path)&&method==='POST')action='delete';
  if(/\/payments$/.test(path)&&method==='POST')action='edit';
  if(/^\/api\/vendors\/[^/]+\/(pay|return-products|give-products|receive-payment|receive-products)$/.test(path)&&method==='POST')action='edit';
  if(path==='/api/settings/invoice-logo'&&(method==='POST'||method==='DELETE'))action='edit';
  return {moduleKey:found[1],action};
}

export async function enforceRequestPermission(db:SherDatabase,user:AuthUser,path:string,method:string):Promise<Response|null>{
  const info=permissionRouteInfo(path,method); if(!info)return null;
  if(info.action!=='delete') return requireModulePermission(db,user,info.moduleKey,info.action);
  if(info.moduleKey==='users'||info.moduleKey==='roles') return requireManagementDelete(db,user,info.moduleKey as 'users'|'roles');
  const date=await resolveDeleteRecordDate(db,path,info.moduleKey);
  return requireDeleteWindow(db,user,info.moduleKey,date);
}
