<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { notifySuccess, notifyError } from '../utils/notify';
import ModuleTabs from './ModuleTabs.vue';
import {
  getSettingsBootstrap,
  updateSettings,
  getInvoiceDesignBootstrap,
  uploadInvoiceLogo,
  removeInvoiceLogo
} from '../api';
import type { AuthUser, ModulePermission, SettingsBootstrap } from '../types';
import UsersPanel from './UsersPanel.vue';
import RolesPanel from './RolesPanel.vue';
import SystemAdminPanel from './SystemAdminPanel.vue';

type TabKey = 'general' | 'invoice' | 'users' | 'roles' | 'system';
const props = defineProps<{ authUser: AuthUser }>();
const activeTab = ref<TabKey>('general');
type RefreshableChild = { refresh: () => Promise<void> | void };
const usersPanel = ref<RefreshableChild | null>(null);
const rolesPanel = ref<RefreshableChild | null>(null);
const systemPanel = ref<RefreshableChild | null>(null);
function canView(key: 'settings'|'users'|'roles'): boolean {
  if (props.authUser.role === 'admin') return true;
  const p = props.authUser.permissions?.[key] as ModulePermission | undefined;
  return !!p?.view;
}
const tabs = computed(() => [
  ...(canView('settings') ? [{ key: 'general' as const, label: 'General', hint: 'সাধারণ সেটিং' }, { key: 'invoice' as const, label: 'Invoice Design', hint: 'রশিদের ডিজাইন' }] : []),
  ...(canView('users') ? [{ key: 'users' as const, label: 'Users', hint: 'কর্মচারীর তালিকা' }] : []),
  ...(canView('roles') ? [{ key: 'roles' as const, label: 'Roles', hint: 'কে কী করতে পারবে' }] : []),
  ...(props.authUser.role === 'admin' ? [{ key: 'system' as const, label: 'System', hint: 'ব্যাকআপ ও অডিট' }] : [])
]);

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const bootstrap = ref<SettingsBootstrap | null>(null);
const logoDataUri = ref('');

const general = reactive<Record<string, string | number | boolean>>({
  'Shop Name': '',
  'Email': '',
  'Currency Symbol': '৳',
  'Currency Code': 'BDT',
  'Tax Percent': 0,
  'Default Discount': 0,
  'Low Stock Threshold': 5,
  'Timezone': 'Asia/Dhaka',
  'Drive Folder Id': '',
  'Default Bank Account': '',
  'Session Timeout Hours': 12,
  'Delete Confirmation Key': '',
  'Day Book Editable Days': 0,
  'POS Show Purchase Price': false
});

const invoice = reactive({
  shopNameBangla: '',
  proprietorName: '',
  proprietorParagraph: '',
  invoiceTitle: 'চালান',
  shopDescription: '',
  address: '',
  phone1: '',
  phone2: '',
  showBismillah: false,
  bismillahText: 'بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ',
  paymentMethods: [] as Array<{ label: string; value: string }>,
  terms: [] as string[],
  footer: '',
  paymentTermsDays: 0,
  paymentTermsText: '',
  receiptSize: '80mm',
  showSignature: true
});

const bankAccounts = computed(() => bootstrap.value?.bankAccounts || []);
const currency = computed(() => String(general['Currency Symbol'] || '৳'));

function settingBool(v: unknown): boolean {
  return v === true || String(v ?? '').trim().toLowerCase() === 'true';
}
function notify(text: string): void { message.value = ''; error.value = ''; notifySuccess(text); }
function fail(text: string): void { error.value = text; message.value = ''; notifyError(text); }

function fillGeneral(s: Record<string, string>): void {
  general['Shop Name'] = s['Shop Name'] || '';
  general['Email'] = s['Email'] || '';
  general['Currency Symbol'] = s['Currency Symbol'] || '৳';
  general['Currency Code'] = s['Currency Code'] || 'BDT';
  general['Tax Percent'] = Number(s['Tax Percent'] || 0);
  general['Default Discount'] = Number(s['Default Discount'] || 0);
  general['Low Stock Threshold'] = Number(s['Low Stock Threshold'] || 0);
  general['Timezone'] = s['Timezone'] || 'Asia/Dhaka';
  general['Drive Folder Id'] = s['Drive Folder Id'] || '';
  general['Default Bank Account'] = s['Default Bank Account'] || '';
  general['Session Timeout Hours'] = Number(s['Session Timeout Hours'] || 12);
  general['Delete Confirmation Key'] = s['Delete Confirmation Key'] || '';
  general['Day Book Editable Days'] = Number(s['Day Book Editable Days'] || 0);
  general['POS Show Purchase Price'] = settingBool(s['POS Show Purchase Price']);
}
function parseArray<T>(raw: unknown, fallback: T[]): T[] {
  try {
    const x = JSON.parse(String(raw || '[]'));
    return Array.isArray(x) ? x as T[] : fallback;
  } catch { return fallback; }
}
function fillInvoice(s: Record<string, string>): void {
  invoice.shopNameBangla = s['Shop Name Bangla'] || '';
  invoice.proprietorName = s['Invoice Proprietor Name'] || '';
  invoice.proprietorParagraph = s['Invoice Proprietor Paragraph'] || '';
  invoice.invoiceTitle = s['Invoice Title'] || 'চালান';
  invoice.shopDescription = s['Shop Description'] || '';
  invoice.address = s['Address'] || '';
  invoice.phone1 = s['Phone 1'] || '';
  invoice.phone2 = s['Phone 2'] || '';
  invoice.showBismillah = settingBool(s['Invoice Show Bismillah']);
  invoice.bismillahText = s['Invoice Bismillah Text'] || 'بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ';
  invoice.paymentMethods = parseArray<{label:string;value:string}>(s['Invoice Payment Methods'], []);
  invoice.terms = parseArray<string>(s['Invoice Terms'], []);
  invoice.footer = s['Invoice Footer'] || '';
  invoice.paymentTermsDays = Number(s['Invoice Payment Terms Days'] || 0);
  invoice.paymentTermsText = s['Invoice Payment Terms Text'] || '';
  invoice.receiptSize = s['Receipt Size'] || '80mm';
  invoice.showSignature = settingBool(s['Invoice Show Signature']);
}

async function loadGeneral(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    const d = await getSettingsBootstrap();
    bootstrap.value = d;
    fillGeneral(d.settings);
  } catch (e) { fail(e instanceof Error ? e.message : 'Settings failed to load.'); }
  finally { loading.value = false; }
}
async function loadInvoice(): Promise<void> {
  loading.value = true; error.value = '';
  try {
    const d = await getInvoiceDesignBootstrap();
    if (!bootstrap.value) bootstrap.value = { settings: d.settings, bankAccounts: [] };
    fillInvoice(d.settings);
    logoDataUri.value = d.logoDataUri || '';
  } catch (e) { fail(e instanceof Error ? e.message : 'Invoice design failed to load.'); }
  finally { loading.value = false; }
}
async function saveGeneral(): Promise<void> {
  error.value = '';
  if (!String(general['Shop Name'] || '').trim()) { fail('Shop Name is required.'); return; }
  saving.value = true;
  try {
    await updateSettings({
      'Shop Name': String(general['Shop Name'] || '').trim(),
      'Email': String(general['Email'] || '').trim(),
      'Currency Symbol': String(general['Currency Symbol'] || '').trim(),
      'Currency Code': String(general['Currency Code'] || '').trim(),
      'Tax Percent': Number(general['Tax Percent'] || 0),
      'Default Discount': Number(general['Default Discount'] || 0),
      'Low Stock Threshold': Number(general['Low Stock Threshold'] || 0),
      'Timezone': String(general['Timezone'] || '').trim(),
      'Drive Folder Id': String(general['Drive Folder Id'] || '').trim(),
      'Default Bank Account': String(general['Default Bank Account'] || ''),
      'Session Timeout Hours': Number(general['Session Timeout Hours'] || 0),
      'Delete Confirmation Key': String(general['Delete Confirmation Key'] || '').trim(),
      'Day Book Editable Days': Number(general['Day Book Editable Days'] || 0),
      'POS Show Purchase Price': !!general['POS Show Purchase Price']
    });
    notify('Settings saved.');
    await loadGeneral();
  } catch (e) { fail(e instanceof Error ? e.message : 'Could not save settings.'); }
  finally { saving.value = false; }
}
function addMfs(): void { invoice.paymentMethods.push({ label: '', value: '' }); }
function removeMfs(i: number): void { invoice.paymentMethods.splice(i, 1); }
function addTerm(): void { invoice.terms.push(''); }
function removeTerm(i: number): void { invoice.terms.splice(i, 1); }

async function saveInvoice(): Promise<void> {
  error.value = '';
  if (!invoice.shopNameBangla.trim()) { fail('Shop Name (Bangla) is required — it is the shop name shown on invoices.'); return; }
  saving.value = true;
  try {
    await updateSettings({
      'Shop Name Bangla': invoice.shopNameBangla.trim(),
      'Invoice Proprietor Name': invoice.proprietorName.trim(),
      'Invoice Proprietor Paragraph': invoice.proprietorParagraph.trim(),
      'Invoice Title': invoice.invoiceTitle.trim(),
      'Shop Description': invoice.shopDescription.trim(),
      'Address': invoice.address.trim(),
      'Phone 1': invoice.phone1.trim(),
      'Phone 2': invoice.phone2.trim(),
      'Invoice Show Bismillah': invoice.showBismillah,
      'Invoice Bismillah Text': invoice.bismillahText.trim(),
      'Invoice Payment Methods': JSON.stringify(invoice.paymentMethods.filter(x => x.label.trim() || x.value.trim())),
      'Invoice Terms': JSON.stringify(invoice.terms.map(x => x.trim()).filter(Boolean)),
      'Invoice Footer': invoice.footer.trim(),
      'Invoice Payment Terms Days': Number(invoice.paymentTermsDays || 0),
      'Invoice Payment Terms Text': invoice.paymentTermsText.trim(),
      'Receipt Size': invoice.receiptSize,
      'Invoice Show Signature': invoice.showSignature
    });
    notify('Invoice design saved.');
    await loadInvoice();
  } catch (e) { fail(e instanceof Error ? e.message : 'Could not save invoice design.'); }
  finally { saving.value = false; }
}
async function onLogoFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) { fail('Logo must be PNG, JPEG, WEBP or GIF.'); return; }
  if (file.size > 1.5 * 1024 * 1024) { fail('Logo is too large — use an image under 1.5MB.'); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      saving.value = true;
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      const r = await uploadInvoiceLogo(base64, file.type);
      logoDataUri.value = r.dataUri;
      notify('Logo uploaded.');
    } catch (e) { fail(e instanceof Error ? e.message : 'Logo upload failed.'); }
    finally { saving.value = false; input.value = ''; }
  };
  reader.onerror = () => fail('Could not read the selected image.');
  reader.readAsDataURL(file);
}
async function deleteLogo(): Promise<void> {
  if (!logoDataUri.value || !confirm('Remove the invoice logo?')) return;
  try { await removeInvoiceLogo(); logoDataUri.value = ''; notify('Logo removed.'); }
  catch (e) { fail(e instanceof Error ? e.message : 'Could not remove logo.'); }
}

async function refresh(): Promise<void> {
  if (activeTab.value === 'general') await loadGeneral();
  else if (activeTab.value === 'invoice') await loadInvoice();
  else if (activeTab.value === 'users') await usersPanel.value?.refresh();
  else if (activeTab.value === 'roles') await rolesPanel.value?.refresh();
  else if (activeTab.value === 'system') await systemPanel.value?.refresh();
}
defineExpose({ refresh });

const previewOpen = ref(false);
function openPreview(): void { previewOpen.value = true; }

onMounted(async () => {
  const first = tabs.value[0]?.key;
  if (first) activeTab.value = first;
  if (canView('settings')) { await loadGeneral(); await loadInvoice(); }
});
</script>

<template>
  <section class="settings-page">
    <ModuleTabs v-model="activeTab" :tabs="tabs" aria-label="Settings sections" />

    <div v-if="message" class="alert success">{{ message }}</div>
    <div v-if="error" class="alert danger">{{ error }}</div>

    <template v-if="activeTab === 'general'">
      <div class="settings-grid">
        <div class="card settings-card">
          <h3>Shop Info <span class="bn-hint">— দোকানের তথ্য</span></h3>
          <div class="form-grid">
            <div><label>Shop Name (English) *</label><input v-model="general['Shop Name']" /></div>
            <div><label>Email</label><input v-model="general['Email']" /></div>
          </div>
          <p class="setting-help">System name shown on login/sidebar. Bangla shop name, address and invoice branding are under Invoice Design.</p>
        </div>

        <div class="card settings-card">
          <h3>Financial <span class="bn-hint">— টাকাপয়সার সেটিং</span></h3>
          <div class="form-grid">
            <div><label>Currency Symbol</label><input v-model="general['Currency Symbol']" /></div>
            <div><label>Currency Code</label><input v-model="general['Currency Code']" /></div>
            <div><label>Tax Percent</label><input v-model.number="general['Tax Percent']" type="number" min="0" step="0.01" /></div>
            <div><label>Default Discount</label><input v-model.number="general['Default Discount']" type="number" min="0" step="0.01" /></div>
            <div><label>Low Stock Threshold</label><input v-model.number="general['Low Stock Threshold']" type="number" min="0" step="1" /></div>
          </div>
        </div>

        <div class="card settings-card">
          <h3>Receipt & Other <span class="bn-hint">— রশিদ ও অন্যান্য</span></h3>
          <div class="form-grid">
            <div><label>Timezone</label><input v-model="general['Timezone']" placeholder="Asia/Dhaka" /></div>
            <div><label>Drive Folder Id</label><input v-model="general['Drive Folder Id']" /></div>
          </div>
          <p class="setting-help">Cloudflare does not use Google Drive for runtime storage. This field is preserved for compatibility/import history.</p>
        </div>

        <div class="card settings-card">
          <h3>Bank & Session <span class="bn-hint">— ব্যাংক ও ক্যাশ সেশন</span></h3>
          <div class="form-grid">
            <div><label>Default Bank Account</label><select v-model="general['Default Bank Account']"><option value="">None</option><option v-for="b in bankAccounts" :key="b.id" :value="b.id">{{ b.name }}</option></select></div>
            <div><label>Session Timeout (hours)</label><input v-model.number="general['Session Timeout Hours']" type="number" min="1" step="1" /></div>
          </div>
        </div>

        <div class="card settings-card full-width">
          <h3>Security <span class="bn-hint">— নিরাপত্তা</span></h3>
          <div class="form-grid">
            <div class="full"><label>Delete Confirmation Key</label><input v-model="general['Delete Confirmation Key']" /></div>
            <div><label>Day Book Editable Days</label><input v-model.number="general['Day Book Editable Days']" type="number" min="0" step="1" /></div>
          </div>
          <label class="switch-line"><input v-model="general['POS Show Purchase Price']" type="checkbox" /> <span><strong>Show purchase price in POS</strong><small>বিক্রির সময় কেনা দাম দেখান</small></span></label>
          <p class="setting-help">For now the Cloudflare port limits this to administrators. The role-specific POS Cost permission will be wired in the Roles module.</p>
        </div>
      </div>
      <div class="settings-savebar"><button class="btn btn-primary" :disabled="saving || loading" @click="saveGeneral">{{ saving ? 'Saving...' : 'Save Settings' }}</button></div>
    </template>

    <template v-else-if="activeTab === 'invoice'">
      <div class="settings-grid">
        <div class="card settings-card full-width">
          <h3>Shop Identity <span class="bn-hint">— দোকানের নাম ও ঠিকানা</span></h3>
          <div class="form-grid">
            <div class="full"><label>Shop Name (Bangla) *</label><input v-model="invoice.shopNameBangla" /></div>
            <div><label>Proprietor Name</label><input v-model="invoice.proprietorName" /></div>
            <div><label>Invoice Title</label><input v-model="invoice.invoiceTitle" /></div>
            <div class="full"><label>Proprietor Paragraph</label><textarea v-model="invoice.proprietorParagraph"></textarea></div>
            <div class="full"><label>Business Description</label><textarea v-model="invoice.shopDescription"></textarea></div>
            <div class="full"><label>Shop Address</label><input v-model="invoice.address" /></div>
            <div><label>Phone 1</label><input v-model="invoice.phone1" /></div>
            <div><label>Phone 2</label><input v-model="invoice.phone2" /></div>
          </div>
        </div>

        <div class="card settings-card">
          <h3>Logo <span class="bn-hint">— দোকানের লোগো</span></h3>
          <div class="logo-row">
            <div class="logo-preview"><img v-if="logoDataUri" :src="logoDataUri" alt="Invoice logo" /><span v-else>No logo</span></div>
            <div class="logo-actions"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onLogoFile" /><button class="btn btn-danger" :disabled="!logoDataUri" @click="deleteLogo">Remove Logo</button><small>PNG/JPEG/WEBP/GIF, max 1.5MB</small></div>
          </div>
        </div>

        <div class="card settings-card">
          <h3>Bismillah <span class="bn-hint">— বিসমিল্লাহ</span></h3>
          <label class="switch-line"><input v-model="invoice.showBismillah" type="checkbox" /><span>Show Bismillah on invoices</span></label>
          <label>Bismillah Text</label><textarea v-model="invoice.bismillahText" dir="auto"></textarea>
        </div>

        <div class="card settings-card">
          <h3>Mobile Financial Services <span class="bn-hint">— বিকাশ, নগদ নম্বর</span></h3>
          <div v-for="(m,i) in invoice.paymentMethods" :key="i" class="repeat-row"><input v-model="m.label" placeholder="Label e.g. bKash" /><input v-model="m.value" placeholder="Number / details" /><button class="btn btn-danger btn-sm" @click="removeMfs(i)">×</button></div>
          <button class="btn" @click="addMfs">+ Add Number</button>
        </div>

        <div class="card settings-card">
          <h3>Terms & Conditions <span class="bn-hint">— শর্তাবলী</span></h3>
          <div v-for="(t,i) in invoice.terms" :key="i" class="repeat-row term-row"><input v-model="invoice.terms[i]" placeholder="Term" /><button class="btn btn-danger btn-sm" @click="removeTerm(i)">×</button></div>
          <button class="btn" @click="addTerm">+ Add Term</button>
        </div>

        <div class="card settings-card full-width">
          <h3>Footer & Payment Terms <span class="bn-hint">— নিচের লেখা ও শর্ত</span></h3>
          <div class="form-grid">
            <div class="full"><label>Footer Text</label><textarea v-model="invoice.footer"></textarea></div>
            <div><label>Payment Terms (days)</label><input v-model.number="invoice.paymentTermsDays" type="number" min="0" step="1" /></div>
            <div><label>Payment Terms Label</label><input v-model="invoice.paymentTermsText" /></div>
          </div>
        </div>

        <div class="card settings-card full-width">
          <h3>Paper & Visibility <span class="bn-hint">— কাগজের মাপ</span></h3>
          <div class="form-grid">
            <div><label>Thermal Paper Size</label><select v-model="invoice.receiptSize"><option value="58mm">58mm</option><option value="80mm">80mm</option><option value="A4">A4</option></select></div>
            <div><label class="switch-line"><input v-model="invoice.showSignature" type="checkbox" /><span>Show signature lines</span></label></div>
          </div>
        </div>
      </div>
      <div class="settings-savebar"><button class="btn btn-primary" :disabled="saving" @click="saveInvoice">Save Invoice Design</button><button class="btn" @click="openPreview">Preview Sample Invoice</button></div>
    </template>

    <UsersPanel v-else-if="activeTab === 'users'" ref="usersPanel" :auth-user="authUser" />
    <RolesPanel v-else-if="activeTab === 'roles'" ref="rolesPanel" :auth-user="authUser" />
    <SystemAdminPanel v-else-if="activeTab === 'system'" ref="systemPanel" />

    <Teleport to="body">
      <div v-if="previewOpen" class="modal-overlay" @click.self="previewOpen=false">
        <div class="modal invoice-preview-modal">
          <div class="modal-header"><h3>Invoice Preview</h3><button class="modal-close" @click="previewOpen=false">×</button></div>
          <div class="modal-body">
            <div class="preview-paper" :class="'paper-'+invoice.receiptSize.replace('mm','')">
              <div v-if="invoice.showBismillah" class="preview-bismillah">{{ invoice.bismillahText }}</div>
              <div class="preview-head">
                <img v-if="logoDataUri" :src="logoDataUri" />
                <div><h2>{{ invoice.shopNameBangla || 'দোকানের নাম' }}</h2><div>{{ invoice.shopDescription }}</div><div>{{ invoice.address }}</div><div>{{ [invoice.phone1,invoice.phone2].filter(Boolean).join(' • ') }}</div></div>
              </div>
              <h3 class="invoice-title">{{ invoice.invoiceTitle || 'চালান' }}</h3>
              <div class="preview-meta"><span>Invoice: INV-000123</span><span>Date: 2026-08-22</span></div>
              <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody><tr><td>Sample Product</td><td class="num">2</td><td class="num">{{ currency }}500</td><td class="num">{{ currency }}1,000</td></tr></tbody></table>
              <div class="preview-total"><strong>Grand Total</strong><strong>{{ currency }}1,000</strong></div>
              <div v-if="invoice.paymentMethods.length" class="preview-notes"><strong>Payment:</strong><div v-for="m in invoice.paymentMethods" :key="m.label">{{ m.label }}: {{ m.value }}</div></div>
              <ol v-if="invoice.terms.length" class="preview-terms"><li v-for="t in invoice.terms" :key="t">{{ t }}</li></ol>
              <div v-if="invoice.paymentTermsText" class="preview-notes">{{ invoice.paymentTermsText }}</div>
              <div v-if="invoice.showSignature" class="signature-row"><span>Customer Signature</span><span>Authorized Signature</span></div>
              <div class="preview-footer">{{ invoice.footer }}</div>
            </div>
          </div>
          <div class="modal-footer"><button class="btn" @click="previewOpen=false">Close</button></div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.settings-card{margin:0}.settings-card.full-width{grid-column:1/-1}.settings-card h3{font-size:14px;margin:0 0 12px}.setting-help{font-size:12px;color:var(--color-text-muted,#64748b);margin:10px 0 0}.settings-savebar{position:sticky;bottom:0;z-index:4;display:flex;justify-content:flex-end;gap:8px;padding:12px 0;background:linear-gradient(to top,var(--color-bg,#f5f7fb) 70%,transparent)}textarea{min-height:58px;resize:vertical}.switch-line{display:flex;align-items:center;gap:9px;cursor:pointer;margin-top:10px}.switch-line input{width:16px;height:16px;flex:0 0 auto}.switch-line span{display:grid}.switch-line small{font-size:11px;color:var(--color-text-muted,#64748b)}.logo-row{display:flex;gap:14px;align-items:flex-start}.logo-preview{width:90px;height:90px;border:1px dashed var(--color-border,#dbe3ef);border-radius:10px;display:grid;place-items:center;overflow:hidden;background:#f8fafc;color:#64748b;font-size:11px}.logo-preview img{max-width:100%;max-height:100%;object-fit:contain}.logo-actions{display:grid;gap:8px;flex:1}.logo-actions small{color:#64748b}.repeat-row{display:grid;grid-template-columns:1fr 1fr auto;gap:6px;margin-bottom:6px}.term-row{grid-template-columns:1fr auto}.invoice-preview-modal{max-width:850px}.preview-paper{max-width:720px;margin:auto;background:#fff;color:#111;padding:24px;border:1px solid #dbe3ef;border-radius:8px}.preview-paper.paper-58{max-width:310px;padding:12px;font-size:11px}.preview-paper.paper-80{max-width:420px;padding:16px;font-size:12px}.preview-bismillah{text-align:center;margin-bottom:8px;font-size:15px}.preview-head{display:flex;gap:12px;align-items:center;text-align:center;justify-content:center}.preview-head img{width:64px;height:64px;object-fit:contain}.preview-head h2{margin:0 0 3px}.invoice-title{text-align:center;border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:6px}.preview-meta,.preview-total,.signature-row{display:flex;justify-content:space-between;gap:10px}.preview-paper table{width:100%;margin:10px 0;border-collapse:collapse}.preview-paper th,.preview-paper td{border-bottom:1px solid #ddd;padding:5px}.preview-total{padding:8px 0}.preview-notes,.preview-terms{font-size:.9em;margin-top:10px}.signature-row{margin-top:30px;padding-top:20px}.signature-row span{border-top:1px solid #444;padding-top:4px}.preview-footer{text-align:center;margin-top:18px;font-size:.9em;color:#555}
@media(max-width:760px){.settings-grid{grid-template-columns:1fr}.settings-card.full-width{grid-column:auto}.settings-savebar{justify-content:stretch}.settings-savebar .btn{flex:1}.repeat-row{grid-template-columns:1fr 1fr auto}.logo-row{flex-direction:column}}
@media(max-width:480px){.repeat-row{grid-template-columns:1fr auto}.repeat-row input:nth-child(2){grid-column:1/-1}.preview-paper{padding:12px}.form-grid{grid-template-columns:1fr!important}}
</style>
