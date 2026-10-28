import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { clearToken, getMe, login, logout, readToken, storeToken, type BackendUser } from './banijjApi';

type GateState = 'loading' | 'signed-out' | 'signed-in';
export const BackendSessionContext = createContext<BackendUser | null>(null);
export const useBackendSession = () => useContext(BackendSessionContext);
export const canUseModule = (user: BackendUser | null, module: string, action: 'view' | 'add' | 'edit' = 'view') =>
  Boolean(user && (user.role === 'admin' || user.permissions?.[module]?.[action] === true));

export function BackendGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GateState>('loading');
  const [user, setUser] = useState<BackendUser | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    if (!readToken()) { setStatus('signed-out'); return; }
    getMe().then(result => {
      if (!active) return;
      setUser(result.user);
      setStatus(result.user ? 'signed-in' : 'signed-out');
    }).catch(() => { if (active) { clearToken(); setStatus('signed-out'); } });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const result = await login(phone.trim(), password);
      if (!result.token || !result.user) throw new Error('Invalid sign-in response');
      storeToken(result.token); setUser(result.user); setStatus('signed-in'); setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally { setSaving(false); }
  }
  async function signOut() {
    try { await logout(); } catch { /* Expired sessions still require local sign-out. */ }
    clearToken(); setUser(null); setStatus('signed-out');
  }
  if (status === 'loading') return <main className="flex min-h-screen items-center justify-center bg-background text-ink-600">
    Checking your BanijjIQ account…
  </main>;
  if (status === 'signed-out') {
    return <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-card">
        <div><h1 className="text-xl font-semibold text-ink">Sign in · BanijjIQ</h1>
          <p className="mt-1 text-sm text-ink-500 font-bn">আপনার ব্যবসার হিসাবে প্রবেশ করুন</p></div>
        <p className="rounded-lg bg-teal-50 p-3 text-xs text-teal-800">
          HisabIQ React migration preview. Products and basic POS are integrated with BanijjIQ APIs; remaining modules still use demo data.
        </p>
        <label className="block text-sm font-medium text-ink-700">Mobile number
          <input required autoComplete="username" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-ink outline-teal-500" />
        </label>
        <label className="block text-sm font-medium text-ink-700">Password
          <input required autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-3 text-ink outline-teal-500" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-danger-bg p-2 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={saving} className="h-10 w-full rounded-lg bg-teal-600 font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
          {saving ? 'Signing in…' : 'Sign in · প্রবেশ করুন'}</button>
      </form>
    </main>;
  }
  return <>
    <div role="status" className="relative z-[200] flex flex-wrap items-center justify-between gap-2 border-b border-warning bg-warning-bg px-3 py-2 text-xs text-warning">
      <span><strong>Migration preview — basic POS posts real accounting transactions.</strong> Products and basic POS use the real API; other modules still use demo data.</span>
      <span className="flex flex-wrap items-center gap-3">
        <a href="#/app/live-products" className="font-semibold underline">Open live products</a>
        <span className="text-ink-600">{user?.fullName}</span>
        <button type="button" onClick={signOut} className="font-semibold underline">Sign out</button>
      </span>
    </div>
    <BackendSessionContext.Provider value={user}>{children}</BackendSessionContext.Provider>
  </>;
}
