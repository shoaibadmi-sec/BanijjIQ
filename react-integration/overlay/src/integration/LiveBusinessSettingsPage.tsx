import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { SettingsDirectory } from '../settings/SettingsDirectory';
import { SettingsTabs } from '../settings/SettingsTabs';
import { settingsSubsections } from '../settings/subsections';
import { sectionNames } from '../settings/fields';
import { useTenantSettings } from '../settings/TenantSettingsProvider';
import { Button, Input, SettingCard, SettingsField } from '../settings/ui';
import { canUseModule, useBackendSession } from './BackendGate';
import { request } from './banijjApi';

const KEYS = ['Shop Name', 'Shop Name Bangla', 'Phone 1', 'Email', 'Address'] as const;
type Key = typeof KEYS[number];
type Fields = Record<Key, string>;
type Bootstrap = { ok: true; settings: Record<string, string> };
const fields: Array<{ key: Key; label: string; bn: string; group: 'general' | 'contact' }> = [
  { key: 'Shop Name', label: 'Business name', bn: 'ব্যবসার নাম', group: 'general' },
  { key: 'Shop Name Bangla', label: 'Bangla business name', bn: 'ব্যবসার বাংলা নাম', group: 'general' },
  { key: 'Phone 1', label: 'Phone number', bn: 'ফোন নম্বর', group: 'contact' },
  { key: 'Email', label: 'Business email', bn: 'ব্যবসার ইমেইল', group: 'contact' },
  { key: 'Address', label: 'Business address', bn: 'ব্যবসার ঠিকানা', group: 'contact' },
];
const fromApi = (settings: Record<string, string>): Fields =>
  Object.fromEntries(KEYS.map(key => [key, String(settings[key] ?? '')])) as Fields;

export function LiveBusinessSettingsPage() {
  const session = useBackendSession();
  const canView = canUseModule(session, 'settings', 'view');
  const canEdit = canUseModule(session, 'settings', 'edit');
  const { personal } = useTenantSettings();
  const navigate = useNavigate();
  const id = 'live-business-settings-' + useId().replace(/:/g, '');
  const [group, setGroup] = useState<'general' | 'contact' | 'branding'>('general');
  const [baseline, setBaseline] = useState<Fields | null>(null);
  const [draft, setDraft] = useState<Fields | null>(null);
  const [loading, setLoading] = useState(canView);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const language = personal.language;

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setLoading(true);
    setError('');
    setNotice('');
    setDraft(null);
    setBaseline(null);
    request<Bootstrap>('/api/settings/bootstrap')
      .then(result => {
        if (!active) return;
        const next = fromApi(result.settings);
        setDraft(next);
        setBaseline(next);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Cannot load business settings.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canView, reload]);

  const changed: Partial<Fields> = {};
  if (draft && baseline) for (const key of KEYS)
    if (draft[key] !== baseline[key]) changed[key] = draft[key];
  const dirty = Object.keys(changed).length > 0;

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function leave(next: string) {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved business settings?')) return;
    navigate('/app/settings/' + next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !draft || !dirty || saving) return;
    if (!draft['Shop Name'].trim() || !draft['Shop Name Bangla'].trim()) {
      setError('Business name and Bangla business name are required.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await request<{ ok: true }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(changed),
      });
      setBaseline({ ...draft });
      setNotice('Business settings saved.');
    } catch (cause) {
      // Keep the draft: network failure may mean the Worker received the update.
      setError(cause instanceof Error ? cause.message : 'Could not confirm saved settings.');
    } finally { setSaving(false); }
  }

  const items = Object.entries(sectionNames).map(([section, info]) => ({ id: section, ...info }));
  return <div data-live-business-settings data-settings-dirty={dirty}
    className="erp-settings min-w-0 flex-1 space-y-5">
    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 data-testid="settings-title" className="text-xl font-semibold tracking-tight text-ink">
          {language === 'Bangla' ? sectionNames.business.bn : sectionNames.business.label}
          {language === 'English + Bangla' && <span lang="bn" className="ml-2 font-bn text-xs font-normal text-helper">{sectionNames.business.bn}</span>}
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">{sectionNames.business.description}</p>
        <p className="mt-1 text-[11px] text-helper">
          Settings · {baseline?.['Shop Name'] || 'Loading authenticated business…'} · BanijjIQ
        </p>
      </div>
      <span className="text-xs text-ink-500">{session?.fullName || 'Authenticated user'}</span>
    </header>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SettingsDirectory items={items} selected="business" language={language}
        id={id + '-directory'} panelId={id + '-content'} onSelect={leave}/>
      <div className="min-w-0 space-y-4">
        <div className="lg:hidden">
          <SettingsTabs id={id + '-main'} panelId={id + '-content'}
            label="Settings categories" value="business" language={language}
            items={items} onChange={leave} />
        </div>
        <div id={id + '-content'} className="min-w-0 space-y-4" role="tabpanel"
          aria-label="Business settings">
          <SettingsTabs secondary inline id={id + '-sub'} panelId={id + '-sub-content'}
            label="Business profile sub-settings" value={group} language={language}
            libraryTitle={sectionNames.business.label} libraryGroup="In this section"
            items={settingsSubsections.business} onChange={next => setGroup(next as typeof group)}/>
          <div id={id + '-sub-content'} role="tabpanel" className="min-w-0 space-y-4">
            {!canView ? <SettingCard title="Settings access unavailable">
              <p role="alert" className="text-sm text-danger">You do not have permission to view business settings.</p>
            </SettingCard> : loading ? <SettingCard title="Business profile">
              <p role="status" className="text-sm text-ink-500">Loading business settings from BanijjIQ…</p>
            </SettingCard> : !draft ? <SettingCard title="Cannot load business settings">
              <p role="alert" className="text-sm text-danger">{error || 'Live settings are unavailable.'}</p>
              <Button variant="outline" size="sm" onClick={() => setReload(n => n + 1)}>Retry</Button>
            </SettingCard> :
              <form onSubmit={event => void save(event)} className="space-y-4">
                {!canEdit && <p role="status" className="rounded-lg bg-info-bg p-3 text-xs text-info">
                  Read-only access. Only authorized employees can change business settings.
                </p>}
                {group === 'branding' ?
                  <SettingCard title="Logo & branding">
                    <p className="text-sm text-ink-600">
                      Business logo changes are not yet connected to live D1 settings. This preview does not save logos.
                    </p>
                  </SettingCard> :
                  <SettingCard title={group === 'general' ? 'General' : 'Contact & address'}>
                    <div className="grid gap-x-6 gap-y-5 md:[grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
                      {fields.filter(field => field.group === group).map(field =>
                        <div key={field.key}>
                          <SettingsField label={field.label} bn={field.bn} language={language}>
                            {(fieldId, descriptionId) => field.key === 'Address' ?
                              <textarea id={fieldId} aria-label={field.label} aria-describedby={descriptionId}
                                className="min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-ink disabled:opacity-70"
                                value={draft[field.key]} disabled={!canEdit || saving}
                                onChange={event => setDraft(current => current && ({ ...current, [field.key]: event.target.value }))} /> :
                              <Input id={fieldId} aria-label={field.label} aria-describedby={descriptionId}
                                className="h-9 w-full" value={draft[field.key]}
                                disabled={!canEdit || saving}
                                onChange={event => setDraft(current => current && ({ ...current, [field.key]: event.target.value }))} />
                            }
                          </SettingsField>
                        </div>
                      )}
                    </div>
                    {group === 'general' && <p className="mt-4 border-t border-border pt-4 text-xs text-helper">
                      Currency: BDT · Timezone: Asia/Dhaka
                    </p>}
                  </SettingCard>}
                {error && <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{error}</p>}
                {notice && <p role="status" className="rounded-lg bg-success-bg p-3 text-sm text-success">{notice}</p>}
                <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-pop">
                  <p className="text-xs text-ink-500">{dirty ? 'Unsaved changes' : 'Business-wide settings · source: BanijjIQ'}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!dirty || saving}
                      onClick={() => { setDraft({ ...baseline! }); setError(''); setNotice(''); }}>Discard</Button>
                    <Button type="submit" size="sm" disabled={!dirty || !canEdit || saving}>
                      {saving ? 'Saving…' : 'Save business settings'}
                    </Button>
                  </div>
                </div>
              </form>}
          </div>
        </div>
      </div>
    </div>
  </div>;
}
