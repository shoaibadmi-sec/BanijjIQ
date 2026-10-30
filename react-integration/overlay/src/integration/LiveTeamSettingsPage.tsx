import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SettingsDirectory } from '../settings/SettingsDirectory';
import { SettingsTabs } from '../settings/SettingsTabs';
import { TeamSettings } from '../settings/TeamSettings';
import { sectionNames } from '../settings/fields';
import {
  permissions as sourcePermissions,
  type BusinessEmployee, type BusinessRole, type SettingsPermission,
  type TeamSettings as SourceTeamData
} from '../settings/model';
import { useTenantSettings } from '../settings/TenantSettingsProvider';
import { canUseModule, useBackendSession } from './BackendGate';
import { request } from './banijjApi';

// The original HisabIQ_UI TeamSettings and EmployeeDirectory own ALL presentation.
// This is an authenticated data adapter only, not a replacement team design.
type UserRow = {
  id:string; name:string; mobile:string; role:string;
  status:string; email?:string; joinedDate?:string; createdAt?:string
};
type Capability={view?:boolean;add?:boolean;edit?:boolean;delete?:boolean|string};
type RoleRow={id:string;name:string;status:string;permissions:Record<string,Capability>};
type UsersResult={ok:true;users:UserRow[]};
type RolesResult={ok:true;roles:RoleRow[]};
type Load<T>={pending:boolean;value:T|null;error:string};
const idle=<T,>():Load<T>=>({pending:false,value:null,error:''});
const loading=<T,>():Load<T>=>({pending:true,value:null,error:''});
const errorText=(e:unknown)=>e instanceof Error?e.message:'Cannot load team data';

// Only map semantics that the original UI can truthfully represent.
// The backend remains the authority for ALL permissions, not these labels.
function displayPermissions(grants:Record<string,Capability>={}):SettingsPermission[]{
  const p=new Set<SettingsPermission>();
  if(grants.users?.view)p.add('user.account.view');
  if(grants.users?.add)p.add('user.account.create');
  if(grants.users?.edit)p.add('user.account.edit');
  if(grants.roles?.view)p.add('user.role.view');
  if(grants.roles?.add||grants.roles?.edit)p.add('user.role.manage');
  if(grants.settings?.view)p.add('settings.setting.view');
  if(grants.settings?.edit)p.add('settings.setting.edit');
  for(const [backend,frontend] of [
    ['sales','sales'],['products','products'],['purchase','purchases'],
    ['notifications','notifications'],['invoices','invoices']
  ] as const)if(grants[backend]?.view)p.add(frontend);
  return [...p];
}

export function LiveTeamSettingsPage(){
  const actor=useBackendSession();
  const canUsers=canUseModule(actor,'users','view');
  const canRoles=canUseModule(actor,'roles','view');
  const {state,personal}=useTenantSettings();
  const navigate=useNavigate();
  const id='live-team-source-'+useId().replace(/:/g,'');
  const [users,setUsers]=useState<Load<UserRow[]>>(canUsers?loading():idle());
  const [roles,setRoles]=useState<Load<RoleRow[]>>(canRoles?loading():idle());
  useEffect(()=>{
    if(!canUsers){setUsers(idle());return;}
    let alive=true;
    setUsers(loading());
    request<UsersResult>('/api/users').then(result=>{
      if(alive)setUsers({pending:false,value:result.users,error:''});
    }).catch(cause=>{if(alive)setUsers({pending:false,value:null,error:errorText(cause)});});
    return()=>{alive=false;};
  },[canUsers]);
  useEffect(()=>{
    if(!canRoles){setRoles(idle());return;}
    let alive=true;
    setRoles(loading());
    request<RolesResult>('/api/roles').then(result=>{
      if(alive)setRoles({pending:false,value:result.roles,error:''});
    }).catch(cause=>{if(alive)setRoles({pending:false,value:null,error:errorText(cause)});});
    return()=>{alive=false;};
  },[canRoles]);

  const team=useMemo<SourceTeamData>(()=>{
    const employees:BusinessEmployee[]=(users.value||[]).map(u=>({
      id:u.id,name:u.name,email:u.email||'',
      // An account creation date is NOT an employee's joined date.
      joinedDate:u.joinedDate||undefined,
      roleIds:[u.role==='admin'?'owner':u.role],active:u.status==='Active'
    }));
    const savedRoles:BusinessRole[]=(roles.value||[]).map(r=>({
      // Role assignments in the current backend use role_name, not role_id.
      id:r.name,name:r.name,permissions:displayPermissions(r.permissions)
    }));
    if((users.value||[]).some(u=>u.role==='admin')||actor?.role==='admin')
      savedRoles.unshift({id:'owner',name:'Administrator',permissions:[...sourcePermissions]});
    return {employees,roles:savedRoles};
  },[users.value,roles.value,actor?.role]);

  const authenticatedState=useMemo(()=>{
    const owner=actor?.role==='admin';
    const roleId=owner?'owner':'authenticated-role';
    const authority:BusinessRole={
      id:roleId,name:owner?'Administrator':'Authenticated role',
      permissions:owner?[...sourcePermissions]:displayPermissions(actor?.permissions||{})
    };
    const employee:BusinessEmployee={
      id:actor?.userId||'',name:actor?.fullName||'',email:'',
      roleIds:[roleId],active:true
    };
    return {...state,sections:{...state.sections,team:{roles:[authority],employees:[employee]}}};
  },[actor,state]);

  const sections=Object.entries(sectionNames).map(([section,item])=>({id:section,...item}));
  const language=personal.language;
  const bilingual=(en:string,bn:string)=>language==='Bangla'?bn:en;
  const pending=(canUsers&&users.pending)||(canRoles&&roles.pending);
  const unavailable=(canUsers&&users.error)||(canRoles&&roles.error);
  return <div data-live-team-settings className="erp-settings min-w-0 flex-1 space-y-5">
    <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 data-testid="settings-title" className="text-xl font-semibold tracking-tight text-ink">
          {bilingual('Employees & access','কর্মী ও অনুমতি')}
          {language==='English + Bangla'&&
            <span lang="bn" className="ml-2 font-bn text-xs font-normal text-helper">কর্মী ও অনুমতি</span>}
        </h1>
        <p className="mt-1 text-[13px] text-ink-500">Manage who can access this business and what they can do.</p>
      </div>
      <span className="text-xs text-ink-500">{actor?.fullName}</span>
    </header>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SettingsDirectory items={sections} selected="team" language={language}
        id={id+'-directory'} panelId={id+'-content'}
        onSelect={next=>navigate('/app/settings/'+next)}/>
      <div className="min-w-0 space-y-4">
        <div className="lg:hidden">
          <SettingsTabs id={id+'-main'} panelId={id+'-content'}
            label="Settings categories" value="team" language={language}
            items={sections} onChange={next=>navigate('/app/settings/'+next)}/>
        </div>
        <div id={id+'-content'} role="tabpanel" aria-label="Employees & access" className="min-w-0 space-y-4">
          {!canUsers&&!canRoles&&<p role="alert" className="text-sm text-danger">
            You do not have permission to view employees or roles.
          </p>}
          {pending&&<p role="status" className="text-sm text-helper">Loading team from BanijjIQ…</p>}
          {users.error&&<p role="alert" className="text-sm text-danger">{users.error}</p>}
          {roles.error&&<p role="alert" className="text-sm text-danger">{roles.error}</p>}
          {!pending&&!unavailable&&(canUsers||canRoles)&&
            <TeamSettings
              value={team} state={authenticatedState} actorId={actor?.userId||''}
              onChange={()=>{/* No simulated writes; backend parity required. */}}
              disabled={true} advanced={false} language={language}/>
          }
          {!pending&&!unavailable&&(canUsers||canRoles)&&
            <p className="text-xs text-helper">
              Account changes are temporarily read-only until the original email, joined date,
              multi-role and draft-save workflows are implemented in BanijjIQ.
            </p>}
        </div>
      </div>
    </div>
  </div>;
}
