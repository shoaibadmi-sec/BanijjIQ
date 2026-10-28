import type { SherDatabase } from '../../db/types.js';
import type { AuthUser } from '../auth/types.js';
import {
  getSystemOverviewRoute, createSystemBackupRoute, restoreSystemBackupRoute, getAuditLogRoute,
  getUsersBootstrapRoute, createManagedUserRoute, updateManagedUserRoute, resetManagedUserPasswordRoute,
  setManagedUserStatusRoute, deleteManagedUserRoute, getRolesBootstrapRoute, createManagedRoleRoute,
  updateManagedRoleRoute, setManagedRoleStatusRoute, deleteManagedRoleRoute, getSettingsBootstrapRoute,
  updateSettingsRoute, getInvoiceDesignBootstrapRoute, uploadInvoiceLogoRoute, removeInvoiceLogoRoute
} from './service.js';

async function readBody<T>(request: Request): Promise<T> { try { return await request.json() as T; } catch { throw new Error('Invalid JSON body'); } }
function cleanText(value: unknown): string { return String(value ?? '').trim(); }

export async function handleAdminRoute(db: SherDatabase, request: Request, path: string, auth: AuthUser): Promise<Response | null> {
  const url = new URL(request.url);

  if (path === '/api/admin/system/overview' && request.method === 'GET') return getSystemOverviewRoute(db, auth);
  if (path === '/api/admin/system/backup' && request.method === 'GET') return createSystemBackupRoute(db, auth);
  if (path === '/api/admin/system/restore' && request.method === 'POST') return restoreSystemBackupRoute(db, await readBody<any>(request), auth);
  if (path === '/api/admin/audit' && request.method === 'GET') return getAuditLogRoute(db, url, auth);

  if (path === '/api/users' && request.method === 'GET') return getUsersBootstrapRoute(db, auth);
  if (path === '/api/users' && request.method === 'POST') return createManagedUserRoute(db, await readBody<any>(request), auth);
  const userResetMatch = path.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if (userResetMatch && request.method === 'POST') return resetManagedUserPasswordRoute(db, decodeURIComponent(userResetMatch[1]), await readBody<any>(request), auth);
  const userStatusMatch = path.match(/^\/api\/users\/([^/]+)\/status$/);
  if (userStatusMatch && request.method === 'PUT') { const body=await readBody<{status?:string}>(request); return setManagedUserStatusRoute(db, decodeURIComponent(userStatusMatch[1]), cleanText(body.status), auth); }
  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && request.method === 'PUT') return updateManagedUserRoute(db, decodeURIComponent(userMatch[1]), await readBody<any>(request), auth);
  if (userMatch && request.method === 'DELETE') return deleteManagedUserRoute(db, decodeURIComponent(userMatch[1]), auth);

  if (path === '/api/roles' && request.method === 'GET') return getRolesBootstrapRoute(db, auth);
  if (path === '/api/roles' && request.method === 'POST') return createManagedRoleRoute(db, await readBody<any>(request), auth);
  const roleStatusMatch = path.match(/^\/api\/roles\/([^/]+)\/status$/);
  if (roleStatusMatch && request.method === 'PUT') { const body=await readBody<{status?:string}>(request); return setManagedRoleStatusRoute(db, decodeURIComponent(roleStatusMatch[1]), cleanText(body.status), auth); }
  const roleMatch = path.match(/^\/api\/roles\/([^/]+)$/);
  if (roleMatch && request.method === 'PUT') return updateManagedRoleRoute(db, decodeURIComponent(roleMatch[1]), await readBody<any>(request), auth);
  if (roleMatch && request.method === 'DELETE') return deleteManagedRoleRoute(db, decodeURIComponent(roleMatch[1]), auth);

  if (path === '/api/settings/bootstrap' && request.method === 'GET') return getSettingsBootstrapRoute(db, auth);
  if (path === '/api/settings' && request.method === 'PUT') return updateSettingsRoute(db, await readBody<Record<string,unknown>>(request), auth);
  if (path === '/api/settings/invoice-design' && request.method === 'GET') return getInvoiceDesignBootstrapRoute(db, auth);
  if (path === '/api/settings/invoice-logo' && request.method === 'POST') return uploadInvoiceLogoRoute(db, await readBody<{base64Data?:string;mimeType?:string}>(request), auth);
  if (path === '/api/settings/invoice-logo' && request.method === 'DELETE') return removeInvoiceLogoRoute(db, auth);

  return null;
}
