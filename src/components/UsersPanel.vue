<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import {
  createManagedUser, deleteManagedUser, getUsersBootstrap, resetManagedUserPassword,
  setManagedUserStatus, updateManagedUser
} from '../api';
import type { AuthUser, ManagedUser, ModulePermission, UsersBootstrap } from '../types';

const props = defineProps<{ authUser: AuthUser }>();

const data = ref<UsersBootstrap | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const query = ref('');

const editing = ref<ManagedUser | null>(null);
const userModalOpen = ref(false);
const form = reactive({ name: '', mobile: '', role: '', password: '' });
const formError = ref('');

const resetTarget = ref<ManagedUser | null>(null);
const resetPassword = ref('');
const resetError = ref('');

const actionMenu = ref<{ row: ManagedUser; top: number; left: number; width: number } | null>(null);

function permission(action: 'view'|'add'|'edit'|'delete'): boolean {
  if (props.authUser.role === 'admin') return true;
  const p = props.authUser.permissions?.users as ModulePermission | undefined;
  if (!p) return false;
  if (action === 'delete') return p.delete === true || p.delete === 'unlimited';
  return !!p[action];
}
const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  return (data.value?.users || []).filter(u => !q || u.name.toLowerCase().includes(q) || u.mobile.includes(q) || u.roleLabel.toLowerCase().includes(q));
});
function showSuccess(text:string){ message.value=''; error.value=''; notifySuccess(text); }
function showError(text:string){ error.value=text; message.value=''; notifyError(text); }

async function load(): Promise<void> {
  loading.value=true; error.value='';
  try { data.value = await getUsersBootstrap(); }
  catch(e){ showError(e instanceof Error ? e.message : 'Users failed to load.'); }
  finally{ loading.value=false; }
}
function roleLabel(role:string):string { return role === 'admin' ? 'Administrator' : role; }
function formatDateTime(v:string):string {
  if(!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}
function openAdd():void{
  editing.value=null;
  const first = data.value?.canAssignAdministrator ? 'admin' : (data.value?.roles[0]?.name || '');
  Object.assign(form,{name:'',mobile:'',role:first,password:''});
  formError.value=''; userModalOpen.value=true;
}
function openEdit(u:ManagedUser):void{
  closeActions(); editing.value=u;
  Object.assign(form,{name:u.name,mobile:u.mobile,role:u.role,password:''});
  formError.value=''; userModalOpen.value=true;
}
async function saveUser():Promise<void>{
  formError.value='';
  if(!form.name.trim()){ formError.value='Full name is required.'; return; }
  if(!form.mobile.trim()){ formError.value='Mobile number is required.'; return; }
  if(!form.role){ formError.value='Choose a role.'; return; }
  if(!editing.value && form.password.length<6){ formError.value='Password must be at least 6 characters.'; return; }
  saving.value=true;
  try{
    if(editing.value) await updateManagedUser(editing.value.id,{name:form.name.trim(),mobile:form.mobile.trim(),role:form.role});
    else await createManagedUser({name:form.name.trim(),mobile:form.mobile.trim(),role:form.role,password:form.password});
    userModalOpen.value=false; showSuccess('User saved'); await load();
  }catch(e){ formError.value=e instanceof Error?e.message:'Could not save user.'; }
  finally{ saving.value=false; }
}
function openReset(u:ManagedUser):void{ closeActions(); resetTarget.value=u; resetPassword.value=''; resetError.value=''; }
async function saveReset():Promise<void>{
  if(!resetTarget.value)return;
  resetError.value='';
  if(resetPassword.value.length<6){ resetError.value='Password must be at least 6 characters.'; return; }
  saving.value=true;
  try{ await resetManagedUserPassword(resetTarget.value.id,resetPassword.value); resetTarget.value=null; showSuccess('Password reset. All sessions for that user were revoked.'); await load(); }
  catch(e){ resetError.value=e instanceof Error?e.message:'Could not reset password.'; }
  finally{ saving.value=false; }
}
async function toggleStatus(u:ManagedUser):Promise<void>{
  closeActions();
  const next=u.status==='Active'?'Inactive':'Active';
  if(!confirm(`${next==='Inactive'?'Deactivate':'Activate'} "${u.name}"?`))return;
  try{ await setManagedUserStatus(u.id,next); showSuccess('User updated'); await load(); }
  catch(e){ showError(e instanceof Error?e.message:'Could not update user.'); }
}
async function removeUser(u:ManagedUser):Promise<void>{
  closeActions();
  if(!confirm(`Permanently delete "${u.name}"? This cannot be undone.`))return;
  try{ await deleteManagedUser(u.id); showSuccess('User deleted'); await load(); }
  catch(e){ showError(e instanceof Error?e.message:'Could not delete user.'); }
}
function openActions(event:MouseEvent,row:ManagedUser):void{
  event.stopPropagation(); const r=(event.currentTarget as HTMLElement).getBoundingClientRect(); const width=190,gap=8;
  let left=Math.max(gap,Math.min(r.left,window.innerWidth-width-gap)); let top=r.bottom+5;
  if(top+185>window.innerHeight-gap) top=Math.max(gap,r.top-185);
  actionMenu.value={row,top,left,width};
}
function closeActions():void{ actionMenu.value=null; }
function outside(e:Event):void{ const t=e.target as HTMLElement|null; if(!t?.closest('.users-action-menu,.users-action-trigger')) closeActions(); }

defineExpose({ refresh: load });

onMounted(()=>{ document.addEventListener('pointerdown',outside); window.addEventListener('resize',closeActions); window.addEventListener('scroll',closeActions,true); void load(); });
onBeforeUnmount(()=>{ document.removeEventListener('pointerdown',outside); window.removeEventListener('resize',closeActions); window.removeEventListener('scroll',closeActions,true); });
</script>

<template>
  <section class="management-page">
    <div v-if="message" class="alert success">{{ message }}</div>
    <div v-if="error" class="alert danger">{{ error }}</div>

    <div class="toolbar">
      <input v-model="query" class="search-input" placeholder="Search by name, mobile or role..." />
      <div class="toolbar-spacer"></div>
      <button v-if="permission('add')" class="btn btn-primary" @click="openAdd">+ Add User</button>
    </div>

    <div class="card" style="padding:0;">
      <div class="table-scroll">
        <table class="management-table">
          <thead><tr><SortableHeader table-id="users" column="name">Name</SortableHeader><SortableHeader table-id="users" column="mobile">Mobile</SortableHeader><SortableHeader table-id="users" column="roleLabel">Role</SortableHeader><SortableHeader table-id="users" column="status">Status</SortableHeader><SortableHeader table-id="users" column="lastLogin" type="date">Last Login</SortableHeader><th></th></tr></thead>
          <tbody>
            <tr v-for="u in $sortRows('users', rows)" :key="u.id">
              <td><strong>{{ u.name }}</strong></td>
              <td>{{ u.mobile }}</td>
              <td>{{ roleLabel(u.role) }}</td>
              <td><span class="badge" :class="u.status==='Active'?'badge-success':'badge-danger'">{{ u.status }}</span></td>
              <td>{{ formatDateTime(u.lastLogin) }}</td>
              <td class="action-cell"><button class="btn btn-sm action-trigger users-action-trigger" @click="openActions($event,u)">Actions</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!loading && rows.length===0" class="empty-state">No users found.</div>
    </div>

    <Teleport to="body">
      <div v-if="actionMenu" class="action-dropdown users-action-menu" :style="{position:'fixed',top:actionMenu.top+'px',left:actionMenu.left+'px',width:actionMenu.width+'px',zIndex:'10030'}" @pointerdown.stop>
        <button v-if="permission('edit')" @click="openEdit(actionMenu.row)">Edit</button>
        <button v-if="permission('edit')" @click="openReset(actionMenu.row)">Reset Password</button>
        <button v-if="permission('edit')" @click="toggleStatus(actionMenu.row)">{{ actionMenu.row.status==='Active'?'Deactivate':'Activate' }}</button>
        <template v-if="permission('delete')"><div class="action-separator"></div><button class="danger" @click="removeUser(actionMenu.row)">Delete</button></template>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="userModalOpen" class="modal-overlay" @click.self="userModalOpen=false">
        <div class="modal">
          <div class="modal-header"><div><h3>{{ editing?'Edit User':'Add User' }}</h3><span class="bn-hint">কর্মচারীর লগইন তথ্য</span></div><button class="modal-close" @click="userModalOpen=false">×</button></div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="full"><label>Full Name *</label><input v-model.trim="form.name" /></div>
              <div><label>Mobile Number *</label><input v-model.trim="form.mobile" placeholder="e.g. 01700000000" /></div>
              <div><label>Role *</label><select v-model="form.role"><option v-if="data?.canAssignAdministrator" value="admin">Administrator</option><option v-for="r in data?.roles||[]" :key="r.name" :value="r.name">{{ r.label }}</option></select></div>
              <div v-if="!editing" class="full"><label>Password *</label><input v-model="form.password" type="password" placeholder="At least 6 characters" /></div>
            </div>
            <div v-if="formError" class="field-error">{{ formError }}</div>
          </div>
          <div class="modal-footer"><button class="btn" @click="userModalOpen=false">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveUser">{{ saving?'Saving...':'Save User' }}</button></div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="resetTarget" class="modal-overlay" @click.self="resetTarget=null">
        <div class="modal modal-sm">
          <div class="modal-header"><h3>Reset Password — {{ resetTarget.name }}</h3><button class="modal-close" @click="resetTarget=null">×</button></div>
          <div class="modal-body"><label>New Password *</label><input v-model="resetPassword" type="password" placeholder="At least 6 characters" /><div v-if="resetError" class="field-error">{{ resetError }}</div></div>
          <div class="modal-footer"><button class="btn" @click="resetTarget=null">Cancel</button><button class="btn btn-primary" :disabled="saving" @click="saveReset">Reset Password</button></div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.management-table{min-width:760px}
@media(max-width:700px){.management-table{min-width:700px}}
</style>
