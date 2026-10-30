import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { SettingsDirectory } from '../settings/SettingsDirectory';
import { SettingsTabs } from '../settings/SettingsTabs';
import { sectionNames } from '../settings/fields';
import { useTenantSettings } from '../settings/TenantSettingsProvider';
import { Button, Input, SettingCard, SettingsDialog } from '../settings/ui';
import { canUseModule, useBackendSession } from './BackendGate';
import { request } from './banijjApi';

type UserRow = {id:string;name:string;mobile:string;role:string;roleLabel:string;status:string;createdAt:string};
type Capability = {view?:boolean;add?:boolean;edit?:boolean;delete?:boolean|string;backdate?:boolean|string};
type RoleRow = {id:string;name:string;status:string;permissions:Record<string,Capability>};
type UserResponse = {ok:true;users:UserRow[];roles?:Array<{name:string;label:string}>};
type CreateDraft = {name:string;mobile:string;role:string;password:string};
const newEmployee = ():CreateDraft=>({name:'',mobile:'',role:'',password:''});
type ModuleOption={key:string;label:string};
type WindowOption={key:string;label:string};
type RoleGrant={view:boolean;add:boolean;edit:boolean;delete:boolean|string;backdate:string};
type RoleDraft={name:string;permissions:Record<string,RoleGrant>};
const blankRole=():RoleDraft=>({name:'',permissions:{}});
const blankGrant=(key:string):RoleGrant=>({
  view:false,add:false,edit:false,
  delete:key==='users'||key==='roles'?false:'disabled',backdate:'disabled'
});
type RoleResponse = {ok:true;roles:RoleRow[];moduleOptions?:ModuleOption[];deleteWindowOptions?:WindowOption[]};
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
  const [roleOptions,setRoleOptions]=useState<ModuleOption[]>([]);
  const [windowOptions,setWindowOptions]=useState<WindowOption[]>([]);
  const [roleOpen,setRoleOpen]=useState(false);
  const [roleDraft,setRoleDraft]=useState<RoleDraft>(blankRole);
  const [roleError,setRoleError]=useState('');
  const [roleSaving,setRoleSaving]=useState(false);
  const savingRole=useRef(false);
  const [assignableRoles,setAssignableRoles]=useState<string[]>([]);
  const [createOpen,setCreateOpen]=useState(false);
  const [createForm,setCreateForm]=useState<CreateDraft>(newEmployee);
  const [createError,setCreateError]=useState('');
  const [createSaving,setCreateSaving]=useState(false);
  const creating=useRef(false);
  const adminCanCreate=actor?.role==='admin'&&canUsers;
  const adminCanCreateRole=actor?.role==='admin'&&canRoles;
  const active=canUsers&&(tab==='employees'||!canRoles)?'employees':canRoles?'roles':null;
  const language=personal.language;
  const bilingual=(en:string,bn:string)=>language==='Bangla'?bn:en;

  useEffect(()=>{
    if(!canUsers){setUsers(noAccess());return;}
    let current=true;
    setUsers(pending());
    request<UserResponse>('/api/users').then(value=>{
      if(current){
        setUsers({loading:false,data:value.users,error:''});
        setAssignableRoles((value.roles||[]).map(r=>r.name).filter(Boolean));
      }
    }).catch(cause=>{
      if(current){setUsers({loading:false,data:null,error:toMessage(cause)});setAssignableRoles([]);}
    });
    return()=>{current=false;};
  },[canUsers,reload]);

  useEffect(()=>{
    if(!canRoles){setRoles(noAccess());return;}
    let current=true;
    setRoles(pending());
    request<RoleResponse>('/api/roles').then(value=>{
      if(current){
        setRoles({loading:false,data:value.roles,error:''});
        setRoleOptions(Array.isArray(value.moduleOptions)?value.moduleOptions:[]);
        setWindowOptions(Array.isArray(value.deleteWindowOptions)?value.deleteWindowOptions:[]);
      }
    }).catch(cause=>{
      if(current){
        setRoles({loading:false,data:null,error:toMessage(cause)});
        setRoleOptions([]);setWindowOptions([]);
      }
    });
    return()=>{current=false;};
  },[canRoles,reload]);

  function openCreation(){
    if(!adminCanCreate||users.loading||users.error||!assignableRoles.length)return;
    setCreateForm(newEmployee());setCreateError('');setCreateOpen(true);
  }
  async function createEmployee(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!adminCanCreate||creating.current||!assignableRoles.includes(createForm.role))return;
    const name=createForm.name.trim(),mobile=createForm.mobile.trim();
    if(!name||!mobile||createForm.password.length<6){
      setCreateError('Enter a name, mobile number and a password of at least 6 characters.');return;
    }
    creating.current=true;setCreateSaving(true);setCreateError('');
    try{
      await request<{ok:true;id:string}>('/api/users',{
        method:'POST',body:JSON.stringify({name,mobile,role:createForm.role,password:createForm.password})
      });
      setCreateForm(newEmployee());setCreateOpen(false);
      setReload(n=>n+1); // Show the new employee only after a fresh authoritative server GET.
    }catch(cause){setCreateError(toMessage(cause));}
    finally{creating.current=false;setCreateSaving(false);}
  }

  function changeGrant(moduleKey:string,patch:Partial<RoleGrant>){
    setRoleDraft(current=>{
      const previous=current.permissions[moduleKey]||blankGrant(moduleKey);
      const next={...previous,...patch};
      if(patch.view===false)return {...current,permissions:{...current.permissions,[moduleKey]:blankGrant(moduleKey)}};
      if(patch.add===true||patch.edit===true||
        (patch.delete!==undefined&&patch.delete!==false&&patch.delete!=='disabled')||
        (patch.backdate!==undefined&&patch.backdate!=='disabled'))next.view=true;
      return {...current,permissions:{...current.permissions,[moduleKey]:next}};
    });
  }
  function openRoleCreation(){
    if(!adminCanCreateRole||roles.loading||roles.error||!roleOptions.length||savingRole.current)return;
    setRoleDraft(blankRole());setRoleError('');setRoleOpen(true);
  }
  async function submitRole(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!adminCanCreateRole||savingRole.current||!roleOptions.length)return;
    const name=roleDraft.name.trim();
    if(!name){setRoleError('Role name is required.');return;}
    if(name.toLowerCase()==='admin'||name.toLowerCase()==='administrator'){
      setRoleError('Administrator is a protected built-in role.');return;
    }
    const allowed=new Set(roleOptions.map(option=>option.key));
    const permissions=Object.fromEntries(Object.entries(roleDraft.permissions)
      .filter(([key,rights])=>allowed.has(key)&&(rights.view||rights.add||rights.edit||
        rights.delete===true||(typeof rights.delete==='string'&&rights.delete!=='disabled')))
      .map(([key,rights])=>[key,{
        view:rights.view,add:rights.add,edit:rights.edit,
        delete:rights.delete,backdate:rights.backdate
      }]));
    if(!Object.keys(permissions).length){
      setRoleError('Choose at least one module permission.');return;
    }
    savingRole.current=true;setRoleSaving(true);setRoleError('');
    try{
      await request<{ok:true;id:string}>('/api/roles',{
        method:'POST',body:JSON.stringify({name,permissions})
      });
      setRoleOpen(false);setRoleDraft(blankRole());
      setReload(n=>n+1); // Server must confirm the role on the next GET.
    }catch(cause){setRoleError(toMessage(cause));}
    finally{savingRole.current=false;setRoleSaving(false);}
  }

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
        <p className="mt-1 text-[11px] text-helper">Settings · BanijjIQ authenticated users · {adminCanCreate?'Administrator account creation':'Read-only'}</p>
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
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-helper">{shown.length} employees</span>
                          {adminCanCreate&&assignableRoles.length>0&&<Button size="sm" onClick={openCreation}>Add employee</Button>}
                        </div>
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
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-helper">
                          {roles.data?.length||0} saved roles · Administrator is a protected built-in role
                        </p>
                        {adminCanCreateRole&&roleOptions.length>0&&<Button size="sm" onClick={openRoleCreation}>Add role</Button>}
                      </div>
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
              <span>Delegated edits and status changes await RBAC review. Administrators may create employees and roles.</span>
              <button type="button" className="text-primary underline" onClick={()=>setReload(n=>n+1)}>
                Refresh live data
              </button>
            </div>}
          </div>
        </div>
      </div>
    </div>
    <SettingsDialog title="Add employee" description="Create a real business login. The password is sent only to BanijjIQ."
      open={createOpen} onClose={()=>{if(!creating.current){setCreateOpen(false);setCreateForm(newEmployee());setCreateError('');}}}>
      <form className="space-y-4" onSubmit={event=>void createEmployee(event)}>
        <label className="block space-y-1 text-sm text-ink-700">Employee name
          <Input aria-label="Employee name" required autoComplete="name" value={createForm.name}
            disabled={createSaving} onChange={event=>setCreateForm(x=>({...x,name:event.target.value}))}
            className="h-9 w-full" />
        </label>
        <label className="block space-y-1 text-sm text-ink-700">Mobile number
          <Input aria-label="Mobile number" required inputMode="tel" autoComplete="tel" value={createForm.mobile}
            disabled={createSaving} onChange={event=>setCreateForm(x=>({...x,mobile:event.target.value}))}
            className="h-9 w-full" />
        </label>
        <label className="block space-y-1 text-sm text-ink-700">Employee role
          <select aria-label="Employee role" required value={createForm.role} disabled={createSaving}
            onChange={event=>setCreateForm(x=>({...x,role:event.target.value}))}
            className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-ink">
            <option value="">Choose role</option>
            {assignableRoles.map(role=><option value={role} key={role}>{role}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm text-ink-700">Initial password
          <Input aria-label="Initial password" required type="password" minLength={6} autoComplete="new-password"
            value={createForm.password} disabled={createSaving}
            onChange={event=>setCreateForm(x=>({...x,password:event.target.value}))}
            className="h-9 w-full"/>
        </label>
        {createError&&<p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{createError}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={createSaving}
            onClick={()=>{setCreateOpen(false);setCreateForm(newEmployee());setCreateError('');}}>Cancel</Button>
          <Button type="submit" size="sm" disabled={createSaving||!adminCanCreate||!assignableRoles.length}>
            {createSaving?'Creating…':'Create employee'}
          </Button>
        </div>
      </form>
    </SettingsDialog>
    <SettingsDialog title="Create role"
      description="Choose access carefully. Unselected actions, deletion and backdating are disabled."
      open={roleOpen} onClose={()=>{if(!savingRole.current){setRoleOpen(false);setRoleDraft(blankRole());setRoleError('');}}}>
      <form className="space-y-4" onSubmit={event=>void submitRole(event)}>
        <label className="block space-y-1 text-sm text-ink-700">Role name
          <Input aria-label="Role name" className="h-9 w-full" required maxLength={80}
            disabled={roleSaving} value={roleDraft.name}
            onChange={event=>setRoleDraft(d=>({...d,name:event.target.value}))}/>
        </label>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto" role="group" aria-label="Role permissions">
          {roleOptions.map(option=>{
            const grant=roleDraft.permissions[option.key]||blankGrant(option.key);
            const management=option.key==='users'||option.key==='roles';
            return <fieldset key={option.key} disabled={roleSaving}
              className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-semibold text-ink">{option.label}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(['view','add','edit'] as const).map(action=>
                  <label key={action} className="flex items-center gap-2 text-xs text-ink-700">
                    <input type="checkbox" className="size-4 accent-primary"
                      aria-label={option.label+' — '+action[0].toUpperCase()+action.slice(1)}
                      checked={grant[action]}
                      onChange={event=>changeGrant(option.key,{[action]:event.target.checked})}/>
                    {action[0].toUpperCase()+action.slice(1)}
                  </label>)}
                {management&&<label className="flex items-center gap-2 text-xs text-ink-700">
                  <input type="checkbox" className="size-4 accent-primary"
                    aria-label={option.label+' — Delete'} checked={grant.delete===true}
                    onChange={event=>changeGrant(option.key,{delete:event.target.checked})}/>
                  Delete
                </label>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {!management&&<label className="space-y-1 text-[11px] text-helper">
                  <span>Delete window</span>
                  <select aria-label={option.label+' — Delete window'}
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-xs text-ink"
                    value={typeof grant.delete==='string'?grant.delete:'disabled'}
                    onChange={event=>changeGrant(option.key,{delete:event.target.value})}>
                    {windowOptions.map(w=><option key={w.key} value={w.key}>{w.label}</option>)}
                  </select>
                </label>}
                <label className="space-y-1 text-[11px] text-helper">
                  <span>Backdate window</span>
                  <select aria-label={option.label+' — Backdate window'}
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-xs text-ink"
                    value={grant.backdate}
                    onChange={event=>changeGrant(option.key,{backdate:event.target.value})}>
                    {windowOptions.map(w=><option key={w.key} value={w.key}>{w.label}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>;
          })}
        </div>
        {roleError&&<p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{roleError}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" type="button" disabled={roleSaving}
            onClick={()=>{setRoleOpen(false);setRoleDraft(blankRole());setRoleError('');}}>Cancel</Button>
          <Button size="sm" type="submit" disabled={roleSaving||!adminCanCreateRole||!roleOptions.length}>
            {roleSaving?'Creating…':'Create role'}
          </Button>
        </div>
      </form>
    </SettingsDialog>
  </div>;
}
