<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import {
  createManagedRole, deleteManagedRole, getRolesBootstrap, setManagedRoleStatus, updateManagedRole
} from '../api';
import type { AuthUser, DeleteWindowCode, ManagedRole, ModulePermission, RolePermissions, RolesBootstrap } from '../types';

const props = defineProps<{ authUser: AuthUser }>();
const data = ref<RolesBootstrap | null>(null);
const loading = ref(false);
const saving = ref(false);
const query = ref('');
const error = ref('');
const message = ref('');
const modalOpen = ref(false);
const editing = ref<ManagedRole | null>(null);
const roleName = ref('');
const rolePerms = reactive<RolePermissions>({});
const formError = ref('');
const actionMenu = ref<{row:ManagedRole;top:number;left:number;width:number}|null>(null);

function permission(action:'view'|'add'|'edit'|'delete'):boolean{
  if(props.authUser.role==='admin')return true;
  const p=props.authUser.permissions?.roles as ModulePermission|undefined;
  if(!p)return false;
  if(action==='delete')return p.delete===true||p.delete==='unlimited';
  return !!p[action];
}
const rows = computed(()=>{
  const q=query.value.trim().toLowerCase();
  return (data.value?.roles||[]).filter(r=>!q||r.name.toLowerCase().includes(q)||r.allowedModules.join(' ').toLowerCase().includes(q));
});
function showSuccess(t:string){message.value='';error.value='';notifySuccess(t)}
function showError(t:string){error.value=t;message.value='';notifyError(t)}
async function load(){loading.value=true;error.value='';try{data.value=await getRolesBootstrap()}catch(e){showError(e instanceof Error?e.message:'Roles failed to load.')}finally{loading.value=false}}
function emptyPermission(key:string):ModulePermission{
  return {view:false,add:false,edit:false,delete:(key==='users'||key==='roles')?false:'disabled',backdate:'unlimited'};
}
function openAdd(){editing.value=null;roleName.value='';for(const k of Object.keys(rolePerms))delete rolePerms[k];for(const m of data.value?.moduleOptions||[])rolePerms[m.key]=emptyPermission(m.key);formError.value='';modalOpen.value=true}
function openEdit(r:ManagedRole){closeActions();editing.value=r;roleName.value=r.name;for(const k of Object.keys(rolePerms))delete rolePerms[k];for(const m of data.value?.moduleOptions||[]){const p=r.permissions[m.key];rolePerms[m.key]=p?{...p}:emptyPermission(m.key)}formError.value='';modalOpen.value=true}
function deleteValue(key:string):DeleteWindowCode|boolean{return rolePerms[key]?.delete??((key==='users'||key==='roles')?false:'disabled')}
function setDeleteValue(key:string,v:string|boolean){if(!rolePerms[key])rolePerms[key]=emptyPermission(key);rolePerms[key].delete=(key==='users'||key==='roles')?!!v:(v as DeleteWindowCode)}
function cleanPermissions():RolePermissions{
  const out:RolePermissions={};
  for(const m of data.value?.moduleOptions||[]){
    const p=rolePerms[m.key]||emptyPermission(m.key);
    const hasDelete=m.key==='users'||m.key==='roles'?p.delete===true:p.delete!=='disabled';
    if(p.view||p.add||p.edit||hasDelete) out[m.key]={view:!!p.view,add:!!p.add,edit:!!p.edit,delete:p.delete,backdate:p.backdate||'unlimited'};
  }
  return out;
}
async function saveRole(){
  formError.value='';const name=roleName.value.trim();if(!name){formError.value='Role name is required.';return}
  saving.value=true;try{const payload={name,permissions:cleanPermissions()};if(editing.value)await updateManagedRole(editing.value.id,payload);else await createManagedRole(payload);modalOpen.value=false;showSuccess('Role saved');await load()}catch(e){formError.value=e instanceof Error?e.message:'Could not save role.'}finally{saving.value=false}
}
async function toggleStatus(r:ManagedRole){closeActions();const next=r.status==='Active'?'Inactive':'Active';if(!confirm(`${next==='Inactive'?'Deactivate':'Activate'} "${r.name}"?`))return;try{await setManagedRoleStatus(r.id,next);showSuccess('Role updated');await load()}catch(e){showError(e instanceof Error?e.message:'Could not update role.')}}
async function removeRole(r:ManagedRole){closeActions();if(!confirm(`Delete role "${r.name}"? This cannot be undone.`))return;try{await deleteManagedRole(r.id);showSuccess('Role deleted');await load()}catch(e){showError(e instanceof Error?e.message:'Could not delete role.')}}
function moduleLabels(r:ManagedRole):string{return r.allowedModules.map(k=>data.value?.moduleOptions.find(m=>m.key===k)?.label||k).join(', ')||'—'}
function openActions(event:MouseEvent,row:ManagedRole){event.stopPropagation();const rr=(event.currentTarget as HTMLElement).getBoundingClientRect();const width=170,gap=8;let left=Math.max(gap,Math.min(rr.left,window.innerWidth-width-gap));let top=rr.bottom+5;if(top+150>window.innerHeight-gap)top=Math.max(gap,rr.top-150);actionMenu.value={row,top,left,width}}
function closeActions(){actionMenu.value=null}
function outside(e:Event){const t=e.target as HTMLElement|null;if(!t?.closest('.roles-action-menu,.roles-action-trigger'))closeActions()}
defineExpose({ refresh: load });

onMounted(()=>{document.addEventListener('pointerdown',outside);window.addEventListener('resize',closeActions);window.addEventListener('scroll',closeActions,true);void load()})
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',closeActions);window.removeEventListener('scroll',closeActions,true)})
</script>

<template>
  <section class="management-page">
    <div v-if="message" class="alert success">{{ message }}</div>
    <div v-if="error" class="alert danger">{{ error }}</div>
    <div class="toolbar"><input v-model="query" class="search-input" placeholder="Search roles..." /><div class="toolbar-spacer"></div><button v-if="permission('add')" class="btn btn-primary" @click="openAdd">+ Add Role</button></div>
    <div class="card" style="padding:0;">
      <div class="table-scroll"><table class="roles-table"><thead><tr><SortableHeader table-id="roles" column="name">Role</SortableHeader><SortableHeader table-id="roles" column="@len:allowedModules" type="number">Modules</SortableHeader><SortableHeader table-id="roles" column="status">Status</SortableHeader><th></th></tr></thead><tbody>
        <tr v-for="r in $sortRows('roles', rows)" :key="r.id"><td><strong>{{ r.name }}</strong></td><td class="modules-cell">{{ moduleLabels(r) }}</td><td><span class="badge" :class="r.status==='Active'?'badge-success':'badge-danger'">{{ r.status }}</span></td><td class="action-cell"><button class="btn btn-sm action-trigger roles-action-trigger" @click="openActions($event,r)">Actions</button></td></tr>
      </tbody></table></div>
      <div v-if="!loading&&rows.length===0" class="empty-state">No custom roles yet. Administrator already has full access and does not need to be created here.</div>
    </div>

    <Teleport to="body"><div v-if="actionMenu" class="action-dropdown roles-action-menu" :style="{position:'fixed',top:actionMenu.top+'px',left:actionMenu.left+'px',width:actionMenu.width+'px',zIndex:'10030'}" @pointerdown.stop>
      <button v-if="permission('edit')" @click="openEdit(actionMenu.row)">Edit</button><button v-if="permission('edit')" @click="toggleStatus(actionMenu.row)">{{actionMenu.row.status==='Active'?'Deactivate':'Activate'}}</button><template v-if="permission('delete')"><div class="action-separator"></div><button class="danger" @click="removeRole(actionMenu.row)">Delete</button></template>
    </div></Teleport>

    <Teleport to="body">
      <div v-if="modalOpen" class="modal-overlay" @click.self="modalOpen=false">
        <div class="modal modal-lg role-modal">
          <div class="modal-header"><div><h3>{{editing?'Edit Role':'Add Role'}}</h3><span class="bn-hint">কে কী করতে পারবে</span></div><button class="modal-close" @click="modalOpen=false">×</button></div>
          <div class="modal-body">
            <label>Role Name *</label><input v-model.trim="roleName" placeholder="e.g. Cashier, Sales, Accounts" />
            <div class="perm-help">View controls module access. Add/Edit control changes. Users and Roles use a simple Delete permission; business modules use the Delete Window.</div>
            <div class="table-scroll permission-scroll">
              <table class="permission-table"><thead><tr><th>Module</th><th>View</th><th>Add</th><th>Edit</th><th>Delete Window</th></tr></thead><tbody>
                <tr v-for="m in data?.moduleOptions||[]" :key="m.key">
                  <td><strong>{{m.label}}</strong></td>
                  <td><input v-model="rolePerms[m.key].view" type="checkbox" /></td>
                  <td><input v-model="rolePerms[m.key].add" type="checkbox" /></td>
                  <td><input v-model="rolePerms[m.key].edit" type="checkbox" /></td>
                  <td v-if="m.key==='users'||m.key==='roles'"><label class="delete-check"><input :checked="deleteValue(m.key)===true" type="checkbox" @change="setDeleteValue(m.key,($event.target as HTMLInputElement).checked)" /> Delete</label></td>
                  <td v-else><select :value="String(deleteValue(m.key))" @change="setDeleteValue(m.key,($event.target as HTMLSelectElement).value)"><option v-for="o in data?.deleteWindowOptions||[]" :key="o.key" :value="o.key">{{o.label}}</option></select></td>
                </tr>
              </tbody></table>
            </div>
            <div v-if="formError" class="field-error">{{formError}}</div>
          </div>
          <div class="modal-footer"><button class="btn" @click="modalOpen=false">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveRole">{{saving?'Saving...':'Save Role'}}</button></div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.roles-table{min-width:760px}.modules-cell{max-width:560px;white-space:normal}.role-modal{max-width:1000px}.perm-help{margin:10px 0 8px;color:#64748b;font-size:12px}.permission-table{min-width:720px}.permission-table th:not(:first-child),.permission-table td:not(:first-child){text-align:center}.permission-table input[type=checkbox]{width:16px;height:16px}.permission-table select{min-width:120px}.delete-check{display:inline-flex;align-items:center;gap:6px}
</style>
