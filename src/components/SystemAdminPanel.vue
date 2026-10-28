<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import { clearToken, downloadSystemBackup, getAuditLogs, getSystemOverview, restoreSystemBackup } from '../api';
import type { AuditLogRow, SystemBackupFile, SystemOverview } from '../types';
import { downloadJson, exportRowsToCsv } from '../utils/tableOutput';

const today = new Date().toISOString().slice(0,10);
const monthStart = `${today.slice(0,8)}01`;

const overview = ref<SystemOverview|null>(null);
const auditRows = ref<AuditLogRow[]>([]);
const auditTotal = ref(0);
const loading = ref(false);
const restoring = ref(false);
const message = ref('');
const error = ref('');

const filters = reactive({ dateFrom: monthStart, dateTo: today, action:'', entityType:'', query:'' });
const selectedBackup = ref<SystemBackupFile|null>(null);
const selectedBackupName = ref('');
const restoreConfirm = ref('');

const actionOptions = computed(()=>[...new Set(auditRows.value.map(x=>x.action))].sort());
const entityOptions = computed(()=>[...new Set(auditRows.value.map(x=>x.entityType))].sort());

function flash(t:string){message.value='';error.value='';notifySuccess(t)}
function fail(t:string){error.value=t;message.value='';notifyError(t)}

async function loadOverview(){
  try{overview.value=(await getSystemOverview()).overview}
  catch(e){fail(e instanceof Error?e.message:'System overview failed to load.')}
}
async function loadAudit(){
  try{
    const r=await getAuditLogs(filters);
    auditRows.value=r.rows;auditTotal.value=r.total;
  }catch(e){fail(e instanceof Error?e.message:'Audit log failed to load.')}
}
async function loadAll(){
  loading.value=true;error.value='';
  try{await Promise.all([loadOverview(),loadAudit()])}
  finally{loading.value=false}
}
async function makeBackup(){
  error.value='';
  try{
    const backup=await downloadSystemBackup();
    const stamp=backup.createdAt.replace(/[:.]/g,'-');
    downloadJson(backup, `SherERP-D1-Backup-${stamp}`);
    flash('Backup downloaded.');
  }catch(e){fail(e instanceof Error?e.message:'Backup failed.')}
}
function chooseBackup(event:Event){
  const input=event.target as HTMLInputElement;
  const file=input.files?.[0];
  selectedBackup.value=null;selectedBackupName.value='';restoreConfirm.value='';error.value='';
  if(!file)return;
  if(file.size>25*1024*1024){fail('Backup file is too large for in-app restore. Use the CLI/database restore process instead.');input.value='';return;}
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(String(reader.result||''));
      if(parsed?.format!=='SherERP-D1-Backup'||parsed?.version!==1||!parsed?.tables||typeof parsed.tables!=='object') throw new Error();
      selectedBackup.value=parsed as SystemBackupFile;selectedBackupName.value=file.name;
    }catch{fail('This is not a valid SherERP D1 backup file.');input.value='';}
  };
  reader.onerror=()=>fail('Could not read the backup file.');
  reader.readAsText(file);
}
const backupStats=computed(()=>{
  if(!selectedBackup.value)return {tables:0,rows:0,createdAt:''};
  const tables=Object.keys(selectedBackup.value.tables);
  return {tables:tables.length,rows:tables.reduce((n,k)=>n+(selectedBackup.value?.tables[k]?.length||0),0),createdAt:selectedBackup.value.createdAt};
});
async function restoreBackup(){
  if(!selectedBackup.value)return;
  if(restoreConfirm.value!=='RESTORE'){fail('Type RESTORE exactly to confirm.');return;}
  if(!confirm('This will replace the current SherERP business database with the selected backup and sign everyone out. Continue?'))return;
  restoring.value=true;error.value='';
  try{
    const r=await restoreSystemBackup(selectedBackup.value,restoreConfirm.value);
    notifySuccess(`Restore completed. ${r.restoredRows} rows restored. You must sign in again.`, 6000);
    clearToken();
    window.location.reload();
  }catch(e){fail(e instanceof Error?e.message:'Restore failed.')}
  finally{restoring.value=false}
}
function fmt(v:string){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString()}
function exportAudit(){
  exportRowsToCsv({
    filename:`shererp-audit-${filters.dateFrom || 'all'}-${filters.dateTo || today}`,
    columns:[
      {label:'Date',key:'createdAt' as const},
      {label:'User',key:'userName' as const},
      {label:'Action',key:'action' as const},
      {label:'Entity',key:'entityType' as const},
      {label:'Entity ID',key:'entityId' as const},
      {label:'Note',key:'note' as const}
    ],
    rows:auditRows.value
  });
}

defineExpose({ refresh: loadAll });

onMounted(()=>void loadAll());
</script>

<template>
  <section class="system-admin-page">
    <div v-if="message" class="alert success">{{message}}</div>
    <div v-if="error" class="alert danger">{{error}}</div>

    <div class="overview-grid">
      <div class="stat-card"><div class="stat-label">Database Tables</div><div class="stat-value">{{overview?.tableCount??0}}</div></div>
      <div class="stat-card"><div class="stat-label">Stored Rows</div><div class="stat-value">{{overview?.totalRows??0}}</div></div>
      <div class="stat-card"><div class="stat-label">Active Users</div><div class="stat-value">{{overview?.activeUsers??0}}</div></div>
      <div class="stat-card"><div class="stat-label">Active Sessions</div><div class="stat-value">{{overview?.activeSessions??0}}</div></div>
    </div>

    <div class="system-grid">
      <div class="card system-card">
        <h3>Database Backup <span class="bn-hint">— ডাটাবেস ব্যাকআপ</span></h3>
        <p class="help">Downloads a SherERP JSON backup of business data, users, roles, settings and audit history. Login sessions are never included.</p>
        <button class="btn btn-primary" :disabled="loading" @click="makeBackup">Download Backup</button>
        <div class="backup-meta"><span>Last audit activity</span><strong>{{fmt(overview?.lastAuditAt||'')}}</strong></div>
      </div>

      <div class="card system-card restore-card">
        <h3>Restore Backup <span class="bn-hint">— ব্যাকআপ ফিরিয়ে আনুন</span></h3>
        <div class="danger-note">Restore replaces current business records with the uploaded backup. All users will be signed out after a successful restore.</div>
        <input type="file" accept="application/json,.json" @change="chooseBackup">
        <div v-if="selectedBackup" class="restore-preview">
          <div><span>File</span><strong>{{selectedBackupName}}</strong></div>
          <div><span>Created</span><strong>{{fmt(backupStats.createdAt)}}</strong></div>
          <div><span>Tables</span><strong>{{backupStats.tables}}</strong></div>
          <div><span>Rows</span><strong>{{backupStats.rows}}</strong></div>
        </div>
        <label v-if="selectedBackup">Type <strong>RESTORE</strong> to confirm<input v-model.trim="restoreConfirm" autocomplete="off"></label>
        <button v-if="selectedBackup" class="btn btn-danger" :disabled="restoring||restoreConfirm!=='RESTORE'" @click="restoreBackup">{{restoring?'Restoring...':'Restore Database'}}</button>
      </div>

      <div class="card system-card table-count-card">
        <h3>Table Usage <span class="bn-hint">— কোন টেবিলে কত রেকর্ড</span></h3>
        <div class="table-scroll small-scroll"><table><thead><tr><SortableHeader table-id="system-table-usage" column="table">Table</SortableHeader><SortableHeader table-id="system-table-usage" column="rows" type="number" class="num">Rows</SortableHeader></tr></thead><tbody><tr v-for="t in $sortRows('system-table-usage', overview?.tableRows||[])" :key="t.table"><td class="mono">{{t.table}}</td><td class="num mono">{{t.rows}}</td></tr></tbody></table></div>
      </div>
    </div>

    <div class="card audit-card">
      <div class="audit-head"><div><h3>Audit Log <span class="bn-hint">— কে কী পরিবর্তন করেছে</span></h3><small>{{auditTotal}} matching entries</small></div><button class="btn" @click="exportAudit">Export CSV</button></div>
      <div class="toolbar audit-filter">
        <input v-model="filters.dateFrom" type="date">
        <input v-model="filters.dateTo" type="date">
        <select v-model="filters.action"><option value="">All actions</option><option v-for="a in actionOptions" :key="a" :value="a">{{a}}</option></select>
        <select v-model="filters.entityType"><option value="">All entities</option><option v-for="e in entityOptions" :key="e" :value="e">{{e}}</option></select>
        <input v-model.trim="filters.query" class="search-input" placeholder="Search user, ID or note..." @keydown.enter="loadAudit">
        <button class="btn btn-primary" @click="loadAudit">Apply</button>
      </div>
      <div class="table-scroll"><table class="audit-table"><thead><tr><SortableHeader table-id="audit-log" column="createdAt" type="date">Date/Time</SortableHeader><SortableHeader table-id="audit-log" column="userName">User</SortableHeader><SortableHeader table-id="audit-log" column="action">Action</SortableHeader><SortableHeader table-id="audit-log" column="entityType">Entity</SortableHeader><SortableHeader table-id="audit-log" column="entityId">Entity ID</SortableHeader><SortableHeader table-id="audit-log" column="note">Note</SortableHeader></tr></thead><tbody>
        <tr v-for="r in $sortRows('audit-log', auditRows)" :key="r.id"><td>{{fmt(r.createdAt)}}</td><td>{{r.userName||'System'}}</td><td><span class="badge">{{r.action}}</span></td><td>{{r.entityType}}</td><td class="mono">{{r.entityId||'—'}}</td><td>{{r.note||'—'}}</td></tr>
      </tbody></table></div>
      <div v-if="!auditRows.length&&!loading" class="empty-state">No audit entries match these filters.</div>
    </div>
  </section>
</template>

<style scoped>
.system-admin-page{display:grid;gap:12px}.overview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.system-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.system-card{margin:0}.system-card h3,.audit-card h3{font-size:14px;margin:0 0 10px}.help{font-size:12px;color:#64748b;line-height:1.5}.backup-meta{display:grid;gap:2px;margin-top:14px;font-size:12px}.backup-meta span,.restore-preview span{color:#64748b}.danger-note{padding:9px 10px;margin-bottom:10px;border:1px solid #fecaca;background:#fff1f2;color:#9f1239;border-radius:8px;font-size:12px}.restore-card{display:grid;align-content:start;gap:10px}.restore-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px;border:1px solid var(--color-border);border-radius:9px}.restore-preview div{display:grid;gap:2px;font-size:12px}.table-count-card{grid-column:1/-1}.small-scroll{max-height:280px}.audit-card{margin:0}.audit-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.audit-head small{color:#64748b}.audit-filter{display:grid;grid-template-columns:145px 145px 180px 180px minmax(220px,1fr) auto;gap:7px;margin:12px 0}.audit-table{min-width:980px}.audit-table th,.audit-table td{font-size:12px}
@media(max-width:950px){.overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.system-grid{grid-template-columns:1fr}.table-count-card{grid-column:auto}.audit-filter{grid-template-columns:repeat(2,minmax(0,1fr))}.audit-filter .search-input{grid-column:1/-1}}
@media(max-width:520px){.overview-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.restore-preview{grid-template-columns:1fr}.audit-filter{grid-template-columns:1fr}.audit-filter .search-input{grid-column:auto}}
</style>
