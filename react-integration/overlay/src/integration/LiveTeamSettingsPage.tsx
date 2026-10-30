import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { SettingsDirectory } from '../settings/SettingsDirectory';
import { SettingsTabs } from '../settings/SettingsTabs';
import { sectionNames } from '../settings/fields';
import { useTenantSettings } from '../settings/TenantSettingsProvider';
import { Input, SettingCard } from '../settings/ui';
import { canUseModule, useBackendSession } from './BackendGate';
import { request } from './banijjApi';

type UserRow = {id:string;name:string;mobile:string;role:string;roleLabel:string;status:string;createdAt:string};
type Capability = {view?:boolean;add?:boolean;edit?:boolean;delete?:boolean|string;backdate?:boolean|string};
type RoleRow = {id:string;name:string;status:string;permissions:Record<string,Capability>};
type UserResponse = {ok:true;users:UserRow[]};
type RoleResponse = {ok:true;roles:RoleRow[]};
type Source<T> = {loading:boolean;data:T|null;error:string};
const pending = <T,>():Source<T>=>({loading:true,data:null,error:''});
const noAccess = <T,>():Source<T>=>({loading:false,data:null,error:''});
const toMessage=(cause:unknown)=>cause instanceof Error?cause.message:'Could not load live access data.';

export function LiveTeamSettingsPage(){
  const actor=useBackendSession();
  const canUsers=canUseModule(actor,'users','view');
  const canRoles=canUseModule(actor,'roles','view');
  const {personal}=useTenantSettings();
  const navigate=useNavigate();
  const id='live-team-settings-'+useId().replace(/:/g,'');
  const [tab,setTab]=useState<'employees'|'roles'>('employees');
  const [search,setSearch]=useState('');
  const [users,setUsers]=useState<Source<UserRow[]>>(canUsers?pending():noAccess());
  const [roles,setRoles]=useState<Source<RoleRow[]>>(canRoles?pending():noAccess());
  const [reload,setReload]=useState(0);
  const active=canUsers&&(tab==='employees'||!canRoles)?'employees':canRoles?'roles':null;
  const language=personal.language;
  const bilingual=(en:string,bn:string)=>language==='Bangla'?bn:en;

  useEffect(()=>{
    if(!canUsers){setUsers(noAccess());return;}
    let current=true;
    setUsers(pending());
    request<UserResponse>('/api/users').then(value=>{
      if(current)setUsers({loading:false,data:value.users,error:''});
    }).catch(cause=>{
      if(current)setUsers({loading:false,data:null,error:toMessage(cause)});
    });
    return()=>{current=false;};
  },[canUsers,reload]);

  useEffect(()=>{
    if(!canRoles){setRoles(noAccess());return;}
    let current=true;
    setRoles(pending());
    request<RoleResponse>('/api/roles').then(value=>{
      if(current)setRoles({loading:false,data:value.roles,error:''});
    }).catch(cause=>{
      if(current)setRoles({loading:false,data:null,error:toMessage(cause)});
    });
    return()=>{current=false;};
  },[canRoles,reload]);

  const available=users.data||[];
  const shown=useMemo(()=>available.filter(x=>
    [x.name,x.mobile,x.role,x.status].some(s=>s?.toLowerCase().includes(search.trim().toLowerCase()))),
    [available,search]);
  const tabs=[
    ...(canUsers?[{id:'employees',label:'Employees',bn:'কর্মী'}]:[]),
    ...(canRoles?[{id:'roles',label:'Roles & permissions',bn:'ভূমিকা'}]:[])
  ];
  const settingsItems=Object.entries(sectionNames).map(([section,item])=>({id:section,...item}));
  const permissions=(role:RoleRow)=>Object.entries(role.permissions||{}).flatMap(([module,rights])=>
    Object.entries(rights||{}).filter(([name,value])=>value===true||
      ((name==='delete'||name==='backdate')&&typeof value==='string'&&value!=='disabled'))
      .map(([action,value])=>module+'.'+action+(value===true?'':' ('+value+')')));

  return <div data-live-team-settings className="erp-settings min-w-0 flex-1 space-y-5">
    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 data-testid="settings-title" className="text-xl font-semibold tracking-tight text-ink">
          {bilingual('Employees & access','কর্মী ও অনুমতি')}
          {language==='English + Bangla'&&<span lang="bn" className="ml-2 font-bn text-xs font-normal text-helper">কর্মী ও অনুমতি</span>}
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">Manage who can access this business and what they can do.</p>
        <p className="mt-1 text-[11px] text-helper">Settings · BanijjIQ authenticated users · Read-only</p>
      </div>
      <span className="text-xs text-ink-500">{actor?.fullName}</span>
    </header>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SettingsDirectory items={settingsItems} selected="team" language={language}
        id={id+'-directory'} panelId={id+'-content'}
        onSelect={next=>navigate('/app/settings/'+next)}/>
      <div className="min-w-0 space-y-4">
        <div className="lg:hidden">
          <SettingsTabs id={id+'-main'} panelId={id+'-content'}
            label="Settings categories" value="team" language={language}
            items={settingsItems} onChange={next=>navigate('/app/settings/'+next)}/>
        </div>
        <div id={id+'-content'} role="tabpanel" aria-label="Employees & access" className="min-w-0 space-y-4">
          {tabs.length>0&&<SettingsTabs id={id+'-team'} panelId={id+'-team-content'}
            label="Employee settings views" language={language} value={active||''}
            secondary={false} items={tabs} onChange={next=>setTab(next as typeof tab)}/>}
          <div id={id+'-team-content'} role="tabpanel" className="min-w-0 space-y-4">
            {!active?<SettingCard title="Settings access unavailable">
              <p role="alert" className="text-sm text-danger">You do not have permission to view employees or roles.</p>
            </SettingCard>:active==='employees'?
              <div className="space-y-4">
                {users.loading?<p role="status" className="text-sm text-helper">Loading employees from BanijjIQ…</p>:
                  users.error?<SettingCard title="Cannot load employees">
                    <p role="alert" className="text-sm text-danger">{users.error}</p>
                  </SettingCard>:
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Input type="search" aria-label="Search employees"
                          placeholder="Search employees, phone or role…"
                          value={search} onChange={event=>setSearch(event.target.value)}
                          className="h-9 min-w-[180px] max-w-sm flex-1"/>
                        <span className="text-xs text-helper">{shown.length} employees</span>
                      </div>
                      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
                        <div className="overflow-x-auto" role="region" tabIndex={0}
                          aria-label={bilingual('Employees table','কর্মীদের তালিকা')}>
                          <table data-erp-table className="w-full text-left text-sm">
                            <thead className="bg-background text-ink-600"><tr>
                              {['Employee','Mobile','Role','Status','Created'].map(h=>
                                <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
                            </tr></thead>
                            <tbody>
                              {shown.map(u=><tr key={u.id} className="border-t border-border">
                                <td className="px-3 py-2 font-medium text-primary">{u.name}</td>
                                <td className="px-3 py-2">{u.mobile}</td>
                                <td className="px-3 py-2">{u.roleLabel||u.role}</td>
                                <td className="px-3 py-2">
                                  <span className={'rounded-md px-2 py-1 text-xs '+
                                    (u.status==='Active'?'bg-success-bg text-success':'bg-background text-helper')}>
                                    {u.status}</span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs text-helper">
                                  {u.createdAt?.slice(0,10)||'—'}</td>
                              </tr>)}
                              {!shown.length&&<tr><td colSpan={5} className="p-6 text-center text-helper">
                                No matching employees.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </>}
              </div>:
              <div className="space-y-4">
                {roles.loading?<p role="status" className="text-sm text-helper">Loading roles from BanijjIQ…</p>:
                  roles.error?<SettingCard title="Cannot load roles">
                    <p role="alert" className="text-sm text-danger">{roles.error}</p>
                  </SettingCard>:
                    <>
                      <p className="text-xs text-helper">
                        {roles.data?.length||0} saved roles · Administrator is a protected built-in role
                      </p>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {(roles.data||[]).map(role=><section key={role.id}
                          className="rounded-xl border border-border bg-card p-4">
                          <header className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2">
                              <ShieldCheck className="size-5 text-primary" aria-hidden="true"/>
                              <div>
                                <h2 className="text-sm font-semibold text-ink">{role.name}</h2>
                                <p className="text-xs text-helper">{role.status}</p>
                              </div>
                            </div>
                            <span className="text-[11px] text-helper">Custom</span>
                          </header>
                          {permissions(role).length?
                            <ul className="mt-3 space-y-1 text-xs text-ink-600">
                              {permissions(role).map(p=><li key={p}>{p}</li>)}
                            </ul>:<p className="mt-3 text-xs text-helper">No permissions assigned.</p>}
                        </section>)}
                      </div>
                      {!roles.data?.length&&<p className="text-xs text-helper">No custom roles are saved.</p>}
                    </>}
              </div>}
            {active&&<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-helper">
              <span>View-only until delegated RBAC review is complete. No changes are saved here.</span>
              <button type="button" className="text-primary underline" onClick={()=>setReload(n=>n+1)}>
                Refresh live data
              </button>
            </div>}
          </div>
        </div>
      </div>
    </div>
  </div>;
}
