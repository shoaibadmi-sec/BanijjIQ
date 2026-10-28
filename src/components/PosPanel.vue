<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { notifyError, notifySuccess, notifyWarning } from '../utils/notify';
import { downloadElementAsJpg, printInvoiceElement } from '../utils/invoiceOutput';
import InvoicePaper from './InvoicePaper.vue';
import SalesInvoiceDetail from './SalesInvoiceDetail.vue';
import { createProductSearchIndex, findExactBarcodeMatch, searchProductIndex } from '../utils/productSearch';
import {
  addPosVendor, closeCashSession, completeSale, getCashSessionSummary,
  getPosBootstrap, getPosInvoice, getSalesByPhone, setPosVendorStatus,
  startCashSession, getSaleForUpdate, updateSale, getPosProductTrackingOptions
} from '../api';
import type {
  BankAccount, CashSessionSummary, PosCartLine, PosCustomer,
  PosInvoice, PosProduct, PosVendor, PosLoadRequest
} from '../types';

const today = new Date().toISOString().slice(0, 10);
const props = defineProps<{ loadRequest?: PosLoadRequest | null }>();
const emit = defineEmits<{ (e:'update-finished'): void }>();

const loading = ref(false);
const saving = ref(false);
const completeSaleButtonState = ref<'idle'|'loading'|'success'|'error'>('idle');
let completeSaleButtonResetTimer: ReturnType<typeof setTimeout> | null = null;
const error = ref('');
const search = ref('');
const selectedCategory = ref('All');
// SherERP catalogue view: the cashier can switch between compact tiles and rows.
const catalogueView = ref<'grid' | 'list'>('grid');
const highlightedProductIndex = ref(0);
const products = ref<PosProduct[]>([]);
const customers = ref<PosCustomer[]>([]);
const vendors = ref<PosVendor[]>([]);
const vendorsAll = ref<PosVendor[]>([]);
const bankAccounts = ref<BankAccount[]>([]);
const cart = ref<PosCartLine[]>([]);
const serialPickerLineIndex = ref<number | null>(null);
const serialPickerOptions = ref<Array<{serialNumber:string;expiryDate?:string}>>([]);
const serialPickerLoading = ref(false);

const showPurchasePrice = ref(false);
const productCostById = ref<Record<string, number>>({});
const revealedCostProductId = ref('');
let costTimer: ReturnType<typeof setTimeout> | null = null;

const summary = ref<CashSessionSummary | null>(null);
const activeSession = ref<{ sessionId:string; openedAt:string; openingCash:number } | null>(null);
const openingCash = ref(0);
const openingNote = ref('');
const closeCounted = ref(0);
const closeNote = ref('');
const showClose = ref(false);
const showHistory = ref(false);
const showInvoice = ref(false);
const showVendors = ref(false);
const customerMore = ref(false);
const invoice = ref<PosInvoice | null>(null);
const invoiceDesign = reactive({
  shopNameBangla:'', invoiceTitle:'চালান', shopDescription:'', proprietorName:'', proprietorParagraph:'', address:'', phone1:'', phone2:'',
  showBismillah:false, bismillahText:'بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ',
  paymentMethods:[] as Array<{label:string;value:string}>, terms:[] as string[], footer:'',
  paymentTermsText:'', receiptSize:'80mm', showSignature:true
});
const invoiceLogoDataUri = ref('');
const invoiceSettings = ref<Record<string,string>>({});
const historyDetailInvoiceId = ref('');
const invoiceCurrency = ref('৳');
const invoicePrintMode = ref<'a4'|'thermal'>('a4');
const invoicePaperRef = ref<HTMLElement|null>(null);
const history = ref<Array<{ invoiceId:string; date:string; grandTotal:number; paymentStatus:string }>>([]);
const reprintId = ref('');
const newVendor = reactive({ name:'', phone:'' });
const updateInvoiceId = ref('');
const updateReason = ref('');

const sale = reactive({
  customerId:'', customerName:'', customerPhone:'', customerFatherName:'', customerAddress:'',
  date:today, backdatedReason:'', discount:0, amountReceived:null as number|null,
  paymentMethod:'Cash', bankAccountId:''
});

const categories = computed(() => {
  const unique = new Map<string,string>();
  for (const product of products.value) {
    const name = String(product.category || '').trim();
    if (name && !unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  }
  return Array.from(unique.values()).sort((a,b) => a.localeCompare(b, undefined, { sensitivity:'base' }));
});

const productSearchIndex = computed(() => createProductSearchIndex(products.value));
const filteredProducts = computed(() => {
  const category = selectedCategory.value;
  const exactBarcode = findExactBarcodeMatch(productSearchIndex.value, search.value);
  // Scanner input must never be hidden by a selected category chip.
  if (search.value.trim() && exactBarcode) return [exactBarcode];

  const eligible = category === 'All'
    ? productSearchIndex.value
    : productSearchIndex.value.filter(({ product }) => (product.category || '').toLocaleLowerCase() === category.toLocaleLowerCase());
  return searchProductIndex(eligible, search.value).map((result) => result.product);
});

watch(filteredProducts, (rows) => {
  if (!rows.length) highlightedProductIndex.value = -1;
  else highlightedProductIndex.value = Math.min(Math.max(highlightedProductIndex.value, 0), rows.length - 1);
});
watch(search, () => { highlightedProductIndex.value = filteredProducts.value.length ? 0 : -1; });

const subtotal = computed(() => cart.value.reduce((s,l)=>s+(Number(l.qty)||0)*(Number(l.unitPrice)||0),0));
const grandTotal = computed(() => Math.max(0, subtotal.value-(Number(sale.discount)||0)));
const received = computed(() => Math.max(0, Number(sale.amountReceived ?? 0)));
const changeDue = computed(() => Math.max(0, received.value-grandTotal.value));
const dueAmount = computed(() => Math.max(0, grandTotal.value-received.value));
const paymentType = computed<'Cash'|'Due'|'Partial'>(() =>
  received.value <= 0 ? 'Due' : received.value >= grandTotal.value ? 'Cash' : 'Partial'
);
const selectedCustomer = computed(() => customers.value.find(c => c.phone === sale.customerPhone) || null);
const cartCount = computed(() => cart.value.reduce((sum,l)=>sum+Number(l.qty||0),0));

const paymentNeedsAccount = computed(() => sale.paymentMethod === 'Bank' || sale.paymentMethod === 'Mobile Banking');
const filteredBankAccounts = computed(() => {
  if (!paymentNeedsAccount.value) return [];
  const want = sale.paymentMethod === 'Mobile Banking' ? 'Mobile Banking' : 'Bank';
  return bankAccounts.value.filter(a => (a.accountType || 'Bank') === want);
});

function money(v:number){ return Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function formatQty(v:number){ const n=Math.round(Number(v||0)); return n.toLocaleString(); }
function settingBool(v:unknown){ return v===true || String(v??'').trim().toLowerCase()==='true'; }
function parseArray<T>(raw:unknown,fallback:T[]):T[]{ try{const x=JSON.parse(String(raw||'[]'));return Array.isArray(x)?x as T[]:fallback;}catch{return fallback;} }
function fillInvoiceDesign(s:Record<string,string>,logoDataUri:string){
  invoiceSettings.value={...s};
  invoiceDesign.shopNameBangla=s['Shop Name Bangla']||s['Shop Name']||'SherERP';
  invoiceDesign.invoiceTitle=s['Invoice Title']||'চালান';
  invoiceDesign.shopDescription=s['Shop Description']||'';
  invoiceDesign.proprietorName=s['Invoice Proprietor Name']||'';
  invoiceDesign.proprietorParagraph=s['Invoice Proprietor Paragraph']||'';
  invoiceDesign.address=s['Address']||'';
  invoiceDesign.phone1=s['Phone 1']||'';
  invoiceDesign.phone2=s['Phone 2']||'';
  invoiceDesign.showBismillah=settingBool(s['Invoice Show Bismillah']);
  invoiceDesign.bismillahText=s['Invoice Bismillah Text']||'بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ';
  invoiceDesign.paymentMethods=parseArray<{label:string;value:string}>(s['Invoice Payment Methods'],[]);
  invoiceDesign.terms=parseArray<string>(s['Invoice Terms'],[]);
  invoiceDesign.footer=s['Invoice Footer']||'';
  invoiceDesign.paymentTermsText=s['Invoice Payment Terms Text']||'';
  invoiceDesign.receiptSize=s['Receipt Size']||'80mm';
  invoiceDesign.showSignature=settingBool(s['Invoice Show Signature']);
  invoiceLogoDataUri.value=logoDataUri||'';
  invoiceCurrency.value=s['Currency Symbol']||'৳';
}
function invoiceMoney(v:number){ return `${invoiceCurrency.value}${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function toBn(value:unknown){ return String(value??'').replace(/\d/g,d=>'০১২৩৪৫৬৭৮৯'[Number(d)]); }
const bnMonths=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
function invoiceDateBn(v:string){ const d=new Date(`${v}T00:00:00`); return Number.isNaN(d.getTime())?toBn(v):`${toBn(d.getDate())} ${bnMonths[d.getMonth()]} ${toBn(d.getFullYear())}`; }
const bnWords=['শূন্য','এক','দুই','তিন','চার','পাঁচ','ছয়','সাত','আট','নয়','দশ','এগারো','বারো','তেরো','চৌদ্দ','পনের','ষোল','সতের','আঠারো','উনিশ','বিশ','একুশ','বাইশ','তেইশ','চব্বিশ','পঁচিশ','ছাব্বিশ','সাতাশ','আঠাশ','ঊনত্রিশ','ত্রিশ','একত্রিশ','বত্রিশ','তেত্রিশ','চৌত্রিশ','পঁয়ত্রিশ','ছত্রিশ','সাঁইত্রিশ','আটত্রিশ','ঊনচল্লিশ','চল্লিশ','একচল্লিশ','বিয়াল্লিশ','তেতাল্লিশ','চুয়াল্লিশ','পঁয়তাল্লিশ','ছেচল্লিশ','সাতচল্লিশ','আটচল্লিশ','ঊনপঞ্চাশ','পঞ্চাশ','একান্ন','বায়ান্ন','তিপ্পান্ন','চুয়ান্ন','পঞ্চান্ন','ছাপ্পান্ন','সাতান্ন','আটান্ন','ঊনষাট','ষাট','একষট্টি','বাষট্টি','তেষট্টি','চৌষট্টি','পঁয়ষট্টি','ছেষট্টি','সাতষট্টি','আটষট্টি','ঊনসত্তর','সত্তর','একাত্তর','বাহাত্তর','তিয়াত্তর','চুয়াত্তর','পঁচাত্তর','ছিয়াত্তর','সাতাত্তর','আটাত্তর','ঊনআশি','আশি','একাশি','বিরাশি','তিরাশি','চুরাশি','পঁচাশি','ছিয়াশি','সাতাশি','আটাশি','ঊননব্বই','নব্বই','একানব্বই','বিরানব্বই','তিরানব্বই','চুরানব্বই','পঁচানব্বই','ছিয়ানব্বই','সাতানব্বই','আটানব্বই','নিরানব্বই'];
function bnAmountWords(amount:number){ let n=Math.round(Number(amount)||0); if(n<=0)return ''; const out:string[]=[]; const push=(x:number,label:string)=>{if(x)out.push(`${bnWords[x]||toBn(x)} ${label}`)}; const crore=Math.floor(n/10000000);n%=10000000; const lakh=Math.floor(n/100000);n%=100000; const thousand=Math.floor(n/1000);n%=1000; const hundred=Math.floor(n/100);n%=100; push(crore,'কোটি');push(lakh,'লক্ষ');push(thousand,'হাজার');push(hundred,'শত');if(n)out.push(bnWords[n]||toBn(n)); return `${out.join(' ')} টাকা মাত্র`; }
function invoiceMoneyBn(v:number){ return `${invoiceCurrency.value}${toBn(Math.round(Number(v||0)).toLocaleString('en-US'))}`; }
function sessionTime(v?:string){
  if(!v)return '';
  const normalized = v.includes('T') ? v : v.replace(' ','T')+'Z';
  const d=new Date(normalized);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}
function lineShortage(l:PosCartLine){ return Math.max(0,Number(l.qty||0)-Number(l.stock||0)); }
function hasCost(productId:string){ return showPurchasePrice.value && productCostById.value[productId] !== undefined; }
function revealCost(productId:string){
  if(!hasCost(productId)) return;
  if(costTimer){ clearTimeout(costTimer); costTimer=null; }
  if(revealedCostProductId.value===productId){ revealedCostProductId.value=''; return; }
  revealedCostProductId.value=productId;
  costTimer=setTimeout(()=>{ if(revealedCostProductId.value===productId) revealedCostProductId.value=''; },4000);
}
function selectPaymentMethod(method:'Cash'|'Bank'|'Mobile Banking'){
  sale.paymentMethod=method;
  sale.bankAccountId='';
}
watch(filteredBankAccounts, accounts => {
  if(sale.bankAccountId && !accounts.some(a=>a.id===sale.bankAccountId)) sale.bankAccountId='';
});

async function load(){
  loading.value=true; error.value='';
  try {
    const d=await getPosBootstrap();
    products.value=d.products;
    if (selectedCategory.value !== 'All' && !d.products.some(p => (p.category || '').toLowerCase() === selectedCategory.value.toLowerCase())) selectedCategory.value='All';
    customers.value=d.customers;
    vendors.value=d.vendors;
    vendorsAll.value=d.vendorsAll;
    bankAccounts.value=d.bankAccounts;
    activeSession.value=d.activeSession;
    showPurchasePrice.value=!!d.showPurchasePrice;
    fillInvoiceDesign(d.invoiceDesign.settings,d.invoiceDesign.logoDataUri);
    const costMap:Record<string,number>={};
    if(showPurchasePrice.value){
      for(const p of d.products){
        if(p.purchasePrice !== undefined) costMap[p.id]=Number(p.purchasePrice)||0;
      }
    }
    productCostById.value=costMap;
    revealedCostProductId.value='';
    if(d.activeSession) await refreshSummary();
    else summary.value=null;
  } catch(e){ error.value=e instanceof Error?e.message:'POS load failed'; }
  finally { loading.value=false; }
}
async function refreshSummary(){
  const r=await getCashSessionSummary();
  summary.value=r.summary;
  activeSession.value=r.summary ? { sessionId:r.summary.sessionId, openedAt:r.summary.openedAt, openingCash:r.summary.openingCash } : null;
}
async function startDay(){
  error.value='';
  try{ await startCashSession(openingCash.value,openingNote.value); openingNote.value=''; await load(); }
  catch(e){error.value=e instanceof Error?e.message:'Could not start day';}
}
async function closeDay(){
  error.value='';
  try{
    const r=await closeCashSession(closeCounted.value,closeNote.value);
    showClose.value=false; await load();
    notifySuccess(`Day closed. Expected ${money(r.expected)}, Counted ${money(r.counted)}, Variance ${money(r.variance)}`, 5000);
  }catch(e){error.value=e instanceof Error?e.message:'Could not close day';}
}

function addProduct(p:PosProduct){
  const line=cart.value.find(x=>x.productId===p.id);
  if(line) line.qty=Math.round(Number(line.qty||0))+1;
  else cart.value.push({
    productId:p.id,name:p.name,unit:p.unit,qty:1,unitPrice:p.sellingPrice,stock:p.stock,
    vendorId:'',vendorUnitCost:null,fulfillmentMode:p.stock>0?'own':undefined,
    trackSerial:!!p.trackSerial,trackExpiry:!!p.trackExpiry,trackWarranty:!!p.trackWarranty,serialNumbers:[]
  });
}
function clearProductSearch(){ search.value=''; highlightedProductIndex.value=0; }
function onSearchKeydown(e:KeyboardEvent){
  const rows=filteredProducts.value;
  if(e.key==='ArrowDown'){
    if(!rows.length)return; e.preventDefault(); highlightedProductIndex.value=(highlightedProductIndex.value+1+rows.length)%rows.length; return;
  }
  if(e.key==='ArrowUp'){
    if(!rows.length)return; e.preventDefault(); highlightedProductIndex.value=(highlightedProductIndex.value-1+rows.length)%rows.length; return;
  }
  if(e.key==='Escape'){ clearProductSearch(); return; }
  if(e.key!=='Enter')return;
  if(!search.value.trim())return;
  const exact=findExactBarcodeMatch(productSearchIndex.value,search.value);
  const pick=exact || rows[Math.max(0,highlightedProductIndex.value)] || (rows.length===1?rows[0]:undefined);
  if(pick){ e.preventDefault(); addProduct(pick); if(exact) clearProductSearch(); }
}
function removeLine(i:number){ cart.value.splice(i,1); }
function setQty(l:PosCartLine,q:number){
  l.qty=Math.max(1,Math.round(Number(q||1)));
  if(l.trackSerial && (l.serialNumbers?.length||0)>l.qty) l.serialNumbers=(l.serialNumbers||[]).slice(0,l.qty);
  if(lineShortage(l)<=0){ l.fulfillmentMode='own'; l.vendorId=''; l.vendorUnitCost=null; }
}
async function openSerialPicker(index:number){
  const line=cart.value[index];
  if(!line?.trackSerial)return;
  serialPickerLineIndex.value=index;serialPickerLoading.value=true;serialPickerOptions.value=[];
  try{const r=await getPosProductTrackingOptions(line.productId);serialPickerOptions.value=r.serials||[];}
  catch(e){error.value=e instanceof Error?e.message:'Could not load Serial / IMEI options';serialPickerLineIndex.value=null;}
  finally{serialPickerLoading.value=false;}
}
function closeSerialPicker(){serialPickerLineIndex.value=null;serialPickerOptions.value=[];}
function toggleLineSerial(serial:string){
  if(serialPickerLineIndex.value===null)return;const line=cart.value[serialPickerLineIndex.value];if(!line)return;
  const selected=line.serialNumbers||(line.serialNumbers=[]);const idx=selected.findIndex(x=>x.toLocaleLowerCase()===serial.toLocaleLowerCase());
  if(idx>=0){selected.splice(idx,1);return;}
  if(selected.length>=Math.max(1,Math.round(Number(line.qty||1))))return;selected.push(serial);
}
function useOwnStock(l:PosCartLine){
  if(l.stock<=0){error.value=`${l.name}: no own stock available.`;return;}
  l.qty=Math.max(1,Math.round(l.stock)); l.fulfillmentMode='own';l.vendorId='';l.vendorUnitCost=null;
}
function useNegative(l:PosCartLine){l.fulfillmentMode='negative';l.vendorId='';l.vendorUnitCost=null;}
function useVendor(l:PosCartLine){l.fulfillmentMode='vendor';}

function chooseCustomer(){
  const c=customers.value.find(x=>x.phone===sale.customerPhone || x.id===sale.customerId);
  if(!c)return;
  sale.customerId=c.id;sale.customerName=c.name;sale.customerPhone=c.phone;
  sale.customerFatherName=c.fatherName;sale.customerAddress=c.address;
}
function chooseCustomerByName(){
  const c=customers.value.find(x=>x.name.toLowerCase()===sale.customerName.trim().toLowerCase());
  if(!c)return;
  sale.customerId=c.id;sale.customerPhone=c.phone;sale.customerFatherName=c.fatherName;sale.customerAddress=c.address;
}

async function finishSale(){
  error.value='';
  if(!activeSession.value){error.value='Start your cash session first.';return;}
  if(!sale.customerName.trim() || !sale.customerPhone.trim()){error.value='Customer name and phone are required for every sale.';return;}
  if(!cart.value.length){error.value='Cart is empty.';return;}
  if(received.value>0 && paymentNeedsAccount.value && !sale.bankAccountId){
    error.value=sale.paymentMethod==='Mobile Banking'?'Select a mobile banking account.':'Select a bank account.';
    return;
  }
  for(const l of cart.value){
    if(lineShortage(l)>0 && (l.trackSerial || l.trackExpiry)){error.value=`${l.name}: only ${formatQty(l.stock)} fully tracked item(s) are ready. Complete Serial / Expiry tracking first.`;return;}
    if(l.trackSerial && (l.serialNumbers||[]).length!==Math.max(1,Math.round(Number(l.qty||1)))){error.value=`${l.name}: select exactly ${Math.max(1,Math.round(Number(l.qty||1)))} Serial / IMEI number(s).`;return;}
    if(lineShortage(l)>0 && !l.fulfillmentMode){error.value=`${l.name}: choose Own Stock, Vendor Sourcing, or Negative Stock.`;return;}
    if(l.fulfillmentMode==='vendor' && (!l.vendorId || l.vendorUnitCost===null || Number(l.vendorUnitCost)<0)){
      error.value=`${l.name}: select vendor and enter vendor cost.`;return;
    }
  }

  const isUpdating=Boolean(updateInvoiceId.value);
  if(completeSaleButtonResetTimer){clearTimeout(completeSaleButtonResetTimer);completeSaleButtonResetTimer=null;}
  if(!isUpdating)completeSaleButtonState.value='loading';
  saving.value=true;
  try{
    const payload={
      customerId:sale.customerId,customerName:sale.customerName.trim(),customerPhone:sale.customerPhone.trim(),
      customerAddress:sale.customerAddress,customerFatherName:sale.customerFatherName,
      date:today,backdatedReason:'',discount:Number(sale.discount||0),
      paymentType:paymentType.value,paidAmount:paymentType.value==='Partial'?received.value:0,
      paymentMethod:sale.paymentMethod,bankAccountId:sale.bankAccountId,
      items:cart.value.map(l=>({
        productId:l.productId,name:l.name,qty:Math.round(Number(l.qty||1)),unitPrice:Number(l.unitPrice||0),
        stock:l.stock,vendorId:l.vendorId,vendorUnitCost:l.vendorUnitCost,fulfillmentMode:l.fulfillmentMode,serialNumbers:l.trackSerial?(l.serialNumbers||[]):undefined
      }))
    };
    const r=isUpdating
      ? await updateSale(updateInvoiceId.value,{...payload,reason:updateReason.value})
      : await completeSale(payload);
    invoice.value=r.invoice;cart.value=[];
    notifySuccess(isUpdating ? 'Sale updated successfully.' : 'Sale completed successfully.');
    sale.discount=0;sale.amountReceived=null;sale.paymentMethod='Cash';sale.bankAccountId='';
    updateInvoiceId.value='';updateReason.value='';emit('update-finished');

    if(!isUpdating){
      completeSaleButtonState.value='success';
      await new Promise(resolve=>setTimeout(resolve,650));
      completeSaleButtonState.value='idle';
    }
    showInvoice.value=true;
    await load();
  }catch(e){
    error.value=e instanceof Error?e.message:'Sale failed';
    if(!isUpdating){
      completeSaleButtonState.value='error';
      completeSaleButtonResetTimer=setTimeout(()=>{completeSaleButtonState.value='idle';completeSaleButtonResetTimer=null;},1200);
    }
  }finally{saving.value=false;}
}

async function openHistory(){
  if(!sale.customerPhone.trim()){error.value='Enter customer phone first.';return;}
  try{history.value=(await getSalesByPhone(sale.customerPhone.trim())).sales;showHistory.value=true;}
  catch(e){error.value=e instanceof Error?e.message:'History failed';}
}
async function reprint(){
  if(!reprintId.value.trim())return;
  try{invoice.value=(await getPosInvoice(reprintId.value.trim())).invoice;showInvoice.value=true;}
  catch(e){error.value=e instanceof Error?e.message:'Invoice not found';}
}
function newSale(){
  showInvoice.value=false;invoice.value=null;updateInvoiceId.value='';updateReason.value='';
  cart.value=[];sale.customerId='';sale.customerName='';sale.customerPhone='';sale.customerFatherName='';sale.customerAddress='';
  sale.discount=0;sale.amountReceived=null;sale.paymentMethod='Cash';sale.bankAccountId='';
}
async function printInvoice(mode:'a4'|'thermal'='a4'){
  if(!invoicePaperRef.value||!invoice.value)return;
  invoicePrintMode.value=mode;
  await nextTick();
  try{await printInvoiceElement(invoicePaperRef.value,mode,invoiceDesign.receiptSize);}
  catch(e){notifyError(e instanceof Error?e.message:'Could not open print preview.');}
  finally{invoicePrintMode.value='a4';}
}
async function downloadInvoiceJpg(){
  if(!invoicePaperRef.value||!invoice.value)return;
  try{
    const result=await downloadElementAsJpg(invoicePaperRef.value,`${invoice.value.invoiceId}.jpg`,1600);
    if(result.omittedImages>0) notifyWarning('Invoice JPG downloaded. A blocked image was omitted by the browser.');
    else notifySuccess('Invoice JPG downloaded.');
  }
  catch(e){notifyError(e instanceof Error?e.message:'Could not create invoice JPG.');}
}
async function addVendor(){
  if(!newVendor.name.trim())return;
  try{
    const r=await addPosVendor(newVendor.name,newVendor.phone);
    vendorsAll.value.push(r.vendor);vendors.value.push(r.vendor);newVendor.name='';newVendor.phone='';
  }catch(e){error.value=e instanceof Error?e.message:'Vendor add failed';}
}
async function toggleVendor(v:PosVendor){
  try{
    const status=v.status==='Inactive'?'Active':'Inactive';
    await setPosVendorStatus(v.id,status);v.status=status;vendors.value=vendorsAll.value.filter(x=>x.status!=='Inactive');
  }catch(e){error.value=e instanceof Error?e.message:'Vendor status update failed';}
}

async function loadRequestedInvoice(req:PosLoadRequest|null|undefined){
  if(!req?.invoiceId)return;
  error.value='';
  try{
    if(req.mode==='update'){
      const r=await getSaleForUpdate(req.invoiceId),inv=r.sale;
      updateInvoiceId.value=inv.invoiceId;updateReason.value=req.reason||'';
      cart.value=inv.items.map(i=>{
        const p=products.value.find(x=>x.id===i.productId);
        const current=p?.stock||0,vendorQty=Number(i.vendorQty||0),ownQty=Math.max(0,Math.round(Number(i.qty||0))-Math.round(vendorQty));
        return {productId:i.productId,name:i.name,unit:p?.unit||'',qty:Math.max(1,Math.round(i.qty)),unitPrice:i.unitPrice,stock:current+ownQty,vendorId:i.vendorId||'',vendorUnitCost:i.vendorUnitCost??null,fulfillmentMode:vendorQty>0?'vendor':'own',trackSerial:!!p?.trackSerial,trackExpiry:!!p?.trackExpiry,trackWarranty:!!p?.trackWarranty,serialNumbers:[]};
      });
      sale.customerId=inv.customerId||'';sale.customerName=inv.customerName||'';sale.customerPhone=inv.customerPhone||'';
      sale.customerAddress=inv.customerAddress||'';sale.customerFatherName=inv.customerFatherName||'';sale.discount=Number(inv.discount||0);
      sale.amountReceived=Number(inv.paidAmount||0);sale.paymentMethod=inv.paymentMethod||'Cash';sale.bankAccountId=inv.bankAccountId||'';
    }else{
      const r=await getPosInvoice(req.invoiceId),inv=r.invoice;
      updateInvoiceId.value='';updateReason.value='';
      cart.value=inv.items.map(i=>{
        const p=products.value.find(x=>x.id===i.productId);
        return {productId:i.productId,name:i.productName,unit:p?.unit||'',qty:Math.max(1,Math.round(i.quantity)),unitPrice:i.unitPrice,stock:p?.stock||0,vendorId:'',vendorUnitCost:null,fulfillmentMode:'own',trackSerial:!!p?.trackSerial,trackExpiry:!!p?.trackExpiry,trackWarranty:!!p?.trackWarranty,serialNumbers:[]};
      });
      sale.customerId='';sale.customerName=inv.customerName||'';sale.customerPhone=inv.customerPhone||'';
      sale.customerAddress=inv.customerAddress||'';sale.customerFatherName=inv.customerFatherName||'';sale.discount=Number(inv.discount||0);
      sale.amountReceived=null;sale.paymentMethod=inv.paymentMethod||'Cash';sale.bankAccountId='';
    }
  }catch(e){error.value=e instanceof Error?e.message:'Could not load invoice into POS';}
}

watch(()=>props.loadRequest?.nonce,()=>{void loadRequestedInvoice(props.loadRequest);});
defineExpose({ refresh: load });

onMounted(async()=>{await load();if(props.loadRequest)await loadRequestedInvoice(props.loadRequest);});
onBeforeUnmount(()=>{if(costTimer)clearTimeout(costTimer);if(completeSaleButtonResetTimer)clearTimeout(completeSaleButtonResetTimer);});
</script>

<template>
  <section class="gas-pos">
    <div v-if="!activeSession" class="card start-session-card">
      <div class="session-copy">
        <h3>Start your cash session <span class="bn-hint">— ক্যাশ ড্রয়ারে টাকা রাখুন</span></h3>
        <p>Enter how much cash you're putting in the drawer to start the day. You won't be able to take cash payments until a session is open.</p>
      </div>
      <label>Opening Cash <span class="bn-hint">— শুরুর টাকা</span><input v-model.number="openingCash" type="number" min="0" step="0.01"></label>
      <label>Note <span class="bn-hint">— নোট</span><input v-model="openingNote" placeholder="Optional"></label>
      <button class="btn btn-primary btn-lg" @click="startDay">Start Day</button>
    </div>

    <div v-else class="session-banner">
      <div>Opened <span class="bn-hint">শুরু</span> <strong>{{sessionTime(summary?.openedAt)}}</strong></div>
      <div>Opening <span class="bn-hint">শুরুর টাকা</span> <strong>{{money(summary?.openingCash||0)}}</strong></div>
      <div>Cash In <span class="bn-hint">জমা</span> <strong>{{money(summary?.cashIn||0)}}</strong></div>
      <div>Cash Out <span class="bn-hint">খরচ</span> <strong>{{money(summary?.cashOut||0)}}</strong></div>
      <div>Expected in Drawer <span class="bn-hint">ড্রয়ারে থাকার কথা</span> <strong>{{money(summary?.expectedCash||0)}}</strong></div>
      <div class="toolbar-spacer"></div>
      <button class="btn" @click="closeCounted=summary?.expectedCash||0;showClose=true">Close Day</button>
    </div>

    <div v-if="error" class="alert danger">{{error}}</div>
    <div v-if="updateInvoiceId" class="session-banner update-banner">
      <div>Updating invoice <span class="bn-hint">রশিদ পরিবর্তন হচ্ছে</span> <strong class="mono">{{updateInvoiceId}}</strong></div>
      <div class="toolbar-spacer"></div>
      <button class="btn" @click="newSale">Cancel Update</button>
    </div>

    <div class="pos-search-bar">
        <label for="pos-product-search" class="pos-search-label">Search Products <span class="bn-hint">— পণ্য খুঁজুন</span></label>
        <div class="pos-search-wrap">
          <span class="pos-search-icon" aria-hidden="true">⌕</span>
          <input id="pos-product-search" v-model="search" class="search-input pos-search" type="search" autocomplete="off" placeholder="Name, brand, barcode, category or unit..." @keydown="onSearchKeydown">
          <button v-if="search" type="button" class="pos-search-clear" aria-label="Clear product search" title="Clear search" @click="clearProductSearch">×</button>
        </div>

    </div>

    <div class="pos-layout">
      <div class="card product-card-panel">
        <div class="pos-catalogue-tools">
        <div v-if="categories.length" class="category-filter" aria-label="Product categories">
          <button type="button" class="category-chip" :class="{active:selectedCategory==='All'}" @click="selectedCategory='All'">All</button>
          <button v-for="category in categories" :key="category" type="button" class="category-chip" :class="{active:selectedCategory===category}" @click="selectedCategory=category">{{category}}</button>
        </div>

          <div class="pos-view-toggle" role="group" aria-label="Product catalogue view">
            <button type="button" :class="{ active: catalogueView === 'grid' }" :aria-pressed="catalogueView === 'grid'" @click="catalogueView = 'grid'">Grid</button>
            <button type="button" :class="{ active: catalogueView === 'list' }" :aria-pressed="catalogueView === 'list'" @click="catalogueView = 'list'">List</button>
          </div>
        </div>

        <div v-if="loading" class="empty-state">Loading products...</div>
        <div v-else class="product-grid" :class="{ 'is-list': catalogueView === 'list' }">
          <button v-for="(p,index) in filteredProducts" :key="p.id" type="button" class="product-tile" :class="{'is-highlighted':index===highlightedProductIndex}" @mouseenter="highlightedProductIndex=index" @click="addProduct(p)">
            <span class="p-image" aria-hidden="true">{{p.name.slice(0, 2).toUpperCase()}}</span>
            <span class="p-name">{{p.name}}</span>
            <span class="p-price">{{money(p.sellingPrice)}}</span>
            <span class="p-stock" :class="{danger:p.stock<=0}">{{formatQty(p.stock)}} {{p.unit}} in stock</span>
          </button>
        </div>
        <div v-if="!loading&&!filteredProducts.length" class="empty-state">No products found.</div>

        <div class="reprint-row">
          <input v-model.trim="reprintId" type="text" placeholder="Invoice ID to reprint" @keydown.enter="reprint">
          <button class="btn" @click="reprint">Find & Print</button>
        </div>
      </div>

      <div class="card checkout-card">
        <label>Customer Name * <span class="bn-hint">— কাস্টমারের নাম</span></label>
        <input v-model="sale.customerName" type="text" list="posCustomerList" placeholder="Search or type a new name" @change="chooseCustomerByName">
        <datalist id="posCustomerList"><option v-for="c in customers" :key="c.id" :value="c.name">{{c.phone}}</option></datalist>

        <div class="field-gap"></div>
        <label>Phone * <span class="bn-hint">— ফোন নম্বর</span></label>
        <input v-model="sale.customerPhone" type="text" list="posCustomerPhoneList" placeholder="Required for every sale" @change="chooseCustomer">
        <datalist id="posCustomerPhoneList"><option v-for="c in customers" :key="c.id" :value="c.phone">{{c.name}}</option></datalist>

        <div v-if="selectedCustomer" class="totals-row due-old">
          <span>Outstanding Due <span class="bn-hint">— আগের বাকি</span></span>
          <strong class="mono">{{money(selectedCustomer.currentDue)}}</strong>
        </div>

        <div class="customer-actions">
          <button type="button" class="btn btn-sm" @click="customerMore=!customerMore">{{customerMore?'−':'+'}} Father Name / Address</button>
          <button type="button" class="btn btn-sm" @click="openHistory">Sales History for this Phone</button>
        </div>

        <div v-if="customerMore" class="customer-more">
          <label>Father Name <span class="bn-hint">— বাবার নাম</span><input v-model="sale.customerFatherName" type="text" placeholder="Optional"></label>
          <label>Address <span class="bn-hint">— ঠিকানা</span><input v-model="sale.customerAddress" type="text" placeholder="Optional"></label>
        </div>

        <h3 class="cart-title">Cart <span class="bn-hint">— বিক্রির তালিকা</span></h3>
        <div class="cart-list">
          <div v-if="!cart.length" class="empty-state cart-empty">Cart is empty — click a product to add it.</div>

          <template v-for="(l,i) in cart" :key="l.productId">
            <div class="cart-row">
              <div class="c-name">
                <strong>{{l.name}}</strong>
                <div class="cart-meta">
                  {{l.unit||''}}
                  <button
                    v-if="hasCost(l.productId)"
                    type="button"
                    class="c-cost"
                    :class="{'is-revealed':revealedCostProductId===l.productId}"
                    :aria-label="revealedCostProductId===l.productId?'Hide purchase price':'Show purchase price'"
                    @click.stop="revealCost(l.productId)"
                  >{{revealedCostProductId===l.productId?money(productCostById[l.productId]):'▪'}}</button>
                </div>
              </div>
              <input class="cart-qty" :value="l.qty" type="number" min="1" step="1" aria-label="Quantity" @input="setQty(l,Number(($event.target as HTMLInputElement).value))">
              <input class="cart-price" v-model.number="l.unitPrice" type="number" min="0" step="0.01" aria-label="Unit price">
              <div class="c-line-total">{{money(l.qty*l.unitPrice)}}</div>
              <button class="cart-remove" type="button" title="Remove" @click="removeLine(i)">×</button>
            </div>

            <div v-if="l.trackSerial || l.trackExpiry" class="cart-tracking-row">
              <div>
                <strong>{{l.trackSerial?'Serial / IMEI required':'Expiry tracked'}}</strong>
                <span v-if="l.trackSerial" class="bn-hint">{{(l.serialNumbers||[]).length}} / {{Math.max(1,Math.round(Number(l.qty||1)))}} selected</span>
                <span v-else class="bn-hint">Nearest valid expiry stock will be used automatically.</span>
              </div>
              <button v-if="l.trackSerial" type="button" class="btn btn-sm" @click="openSerialPicker(i)">Select Serial / IMEI</button>
            </div>

            <div v-if="lineShortage(l)>0" class="shortage-row">
              <template v-if="l.trackSerial || l.trackExpiry">
                <div class="shortage-head"><strong>Only {{formatQty(l.stock)}} tracked item(s) ready</strong><span>{{formatQty(lineShortage(l))}} item(s) still need valid Serial / Expiry tracking or stock.</span></div>
                <div class="tracked-shortage-note">Tracked products cannot use Vendor Sourcing or Negative Stock. Complete tracking before selling.</div>
              </template>
              <template v-else>
                <div class="shortage-head"><strong>Stock short by {{formatQty(lineShortage(l))}}</strong><span>{{formatQty(l.stock)}} own stock available</span></div>
                <div class="shortage-actions">
                  <button class="btn btn-sm" :class="{active:l.fulfillmentMode==='own'}" @click="useOwnStock(l)">Own Stock</button>
                  <button class="btn btn-sm" :class="{active:l.fulfillmentMode==='vendor'}" @click="useVendor(l)">Vendor Sourcing</button>
                  <button class="btn btn-sm" :class="{active:l.fulfillmentMode==='negative'}" @click="useNegative(l)">Negative Stock</button>
                </div>
                <div v-if="l.fulfillmentMode==='vendor'" class="vendor-source">
                  <select v-model="l.vendorId"><option value="">Select vendor...</option><option v-for="v in vendors" :key="v.id" :value="v.id">{{v.name}}</option></select>
                  <input v-model.number="l.vendorUnitCost" type="number" min="0" step="0.01" placeholder="Vendor cost">
                  <button class="btn btn-sm" @click="showVendors=true">Manage</button>
                </div>
              </template>
            </div>
          </template>
        </div>

        <div class="totals-row"><span>Subtotal <span class="bn-hint">— মোট টাকা</span></span><strong class="mono">{{money(subtotal)}}</strong></div>
        <div class="totals-row"><span>Discount <span class="bn-hint">— ডিসকাউন্ট</span></span><input v-model.number="sale.discount" class="total-input" type="number" min="0" step="0.01"></div>
        <div class="totals-row grand"><span>Grand Total <span class="bn-hint">— সর্বমোট টাকা</span></span><strong class="mono">{{money(grandTotal)}}</strong></div>

        <label class="received-label">Amount Received <span class="bn-hint">— কত টাকা পেলেন</span></label>
        <input v-model.number="sale.amountReceived" type="number" min="0" step="0.01" placeholder="Leave blank for a full due sale">

        <div v-if="changeDue>0" class="totals-row change"><span>Change Due <span class="bn-hint">— ফেরত দেওয়ার টাকা</span></span><strong>{{money(changeDue)}}</strong></div>
        <div v-if="dueAmount>0" class="totals-row due"><span>Due Amount <span class="bn-hint">— বাকি থাকলো</span></span><strong>{{money(dueAmount)}}</strong></div>

        <div class="payment-row">
          <div class="payment-method-field">
            <label>Payment Method <span class="bn-hint">— কীভাবে টাকা নিলেন</span></label>
            <select :value="sale.paymentMethod" @change="selectPaymentMethod(($event.target as HTMLSelectElement).value as 'Cash'|'Bank'|'Mobile Banking')">
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
              <option value="Mobile Banking">Mobile Banking</option>
            </select>
          </div>

          <div v-if="paymentNeedsAccount" class="bank-account-field">
            <label>{{sale.paymentMethod==='Mobile Banking'?'Mobile Banking Account *':'Bank Account *'}} <span class="bn-hint">— ব্যাংক/মোবাইল ব্যাংকিং হিসাব</span></label>
            <select v-model="sale.bankAccountId">
              <option value="">Select account...</option>
              <option v-for="b in filteredBankAccounts" :key="b.id" :value="b.id">{{b.name}}</option>
            </select>
            <small v-if="!filteredBankAccounts.length">No active {{sale.paymentMethod==='Mobile Banking'?'mobile banking':'bank'}} account found.</small>
          </div>
        </div>

        <div class="field-error" v-if="error">{{error}}</div>
        <button
          class="btn btn-primary btn-lg complete-btn"
          :class="{
            'complete-sale-animated':!updateInvoiceId,
            'is-loading':!updateInvoiceId&&completeSaleButtonState==='loading',
            'is-success':!updateInvoiceId&&completeSaleButtonState==='success',
            'is-error':!updateInvoiceId&&completeSaleButtonState==='error'
          }"
          :disabled="saving||(!updateInvoiceId&&completeSaleButtonState!=='idle')||!activeSession"
          @click="finishSale"
        >
          <template v-if="updateInvoiceId">{{saving?'Saving...':'Update Sale'}}</template>
          <Transition v-else name="complete-sale-state" mode="out-in">
            <span :key="completeSaleButtonState" class="complete-sale-content" aria-live="polite">
              <span v-if="completeSaleButtonState==='loading'" class="complete-sale-spinner" aria-hidden="true"></span>
              <span v-else-if="completeSaleButtonState==='success'" class="complete-sale-icon" aria-hidden="true">✓</span>
              <span v-else-if="completeSaleButtonState==='error'" class="complete-sale-icon" aria-hidden="true">×</span>
              <span>{{completeSaleButtonState==='loading'?'Processing...':completeSaleButtonState==='success'?'Sale Complete':completeSaleButtonState==='error'?'Failed':'Complete Sale'}}</span>
            </span>
          </Transition>
        </button>
      </div>
    </div>

    <div v-if="serialPickerLineIndex!==null" class="modal-overlay" @click.self="closeSerialPicker"><div class="modal modal-lg serial-picker-modal">
      <div class="modal-header"><div><h3>Select Serial / IMEI</h3><span class="bn-hint">{{cart[serialPickerLineIndex]?.name}} — choose exactly {{Math.max(1,Math.round(Number(cart[serialPickerLineIndex]?.qty||1)))}}</span></div><button class="modal-close" @click="closeSerialPicker">×</button></div>
      <div class="modal-body">
        <div v-if="serialPickerLoading" class="empty-state">Loading available serials...</div>
        <div v-else class="serial-option-grid">
          <button v-for="opt in serialPickerOptions" :key="opt.serialNumber" type="button" class="serial-option" :class="{selected:(cart[serialPickerLineIndex]?.serialNumbers||[]).includes(opt.serialNumber)}" @click="toggleLineSerial(opt.serialNumber)">
            <span class="mono">{{opt.serialNumber}}</span><small v-if="opt.expiryDate">Expiry {{opt.expiryDate}}</small>
          </button>
        </div>
        <div v-if="!serialPickerLoading && !serialPickerOptions.length" class="empty-state">No ready Serial / IMEI stock is available.</div>
      </div>
      <div class="modal-footer"><span class="serial-picker-count">{{(cart[serialPickerLineIndex]?.serialNumbers||[]).length}} / {{Math.max(1,Math.round(Number(cart[serialPickerLineIndex]?.qty||1)))}} selected</span><button class="btn btn-primary" @click="closeSerialPicker">Done</button></div>
    </div></div>

    <div v-if="showClose" class="modal-overlay"><div class="modal">
      <div class="modal-header"><h3>Close Cash Session <span class="bn-hint">— দিনের হিসাব বন্ধ করুন</span></h3><button class="modal-close" @click="showClose=false">×</button></div>
      <div class="modal-body"><p>Expected in drawer: <strong>{{money(summary?.expectedCash||0)}}</strong></p><label>Counted Cash <input v-model.number="closeCounted" type="number" min="0" step="0.01"></label><label>Note <input v-model="closeNote" type="text"></label></div>
      <div class="modal-footer"><button class="btn" @click="showClose=false">Cancel</button><button class="btn btn-primary" @click="closeDay">Close Day</button></div>
    </div></div>

    <div v-if="showHistory" class="modal-overlay"><div class="modal modal-lg">
      <div class="modal-header"><h3>Sales History <span class="bn-hint">— আগের বিক্রির তালিকা</span> — {{sale.customerPhone}}</h3><button class="modal-close" @click="showHistory=false">×</button></div>
      <div class="modal-body"><div class="table-scroll"><table><thead><tr><SortableHeader table-id="pos-customer-history" column="invoiceId">Invoice</SortableHeader><SortableHeader table-id="pos-customer-history" column="date" type="date">Date</SortableHeader><SortableHeader table-id="pos-customer-history" column="grandTotal" type="number" class="num">Total</SortableHeader><SortableHeader table-id="pos-customer-history" column="paymentStatus">Status</SortableHeader><th></th></tr></thead><tbody><tr v-for="h in $sortRows('pos-customer-history', history)" :key="h.invoiceId"><td class="mono">{{h.invoiceId}}</td><td>{{h.date}}</td><td class="num">{{money(h.grandTotal)}}</td><td>{{h.paymentStatus}}</td><td><button class="btn btn-sm" @click="historyDetailInvoiceId=h.invoiceId">View</button></td></tr></tbody></table></div><div v-if="!history.length" class="empty-state">No past sales found for this phone number.</div></div>
    </div></div>

    <div v-if="showInvoice&&invoice" class="modal-overlay invoice-overlay"><div class="modal modal-xl invoice-modal">
      <div class="modal-header"><h3>Invoice <span class="bn-hint">— রশিদ</span></h3><button class="modal-close" @click="showInvoice=false">×</button></div>
      <div class="modal-body invoice-modal-body">
        <div ref="invoicePaperRef" class="invoice-paper-host">
          <InvoicePaper :invoice="invoice" :settings="invoiceSettings" :logo-data-uri="invoiceLogoDataUri" :mode="invoicePrintMode" />
        </div>
      </div>
      <div class="modal-footer invoice-actions"><button class="btn" @click="newSale">New Sale</button><button class="btn" @click="downloadInvoiceJpg">Download JPG</button><button class="btn" @click="printInvoice('thermal')">Thermal Print</button><button class="btn btn-primary" @click="printInvoice('a4')">Print</button></div>
    </div></div>

    <SalesInvoiceDetail
      :open="!!historyDetailInvoiceId"
      :invoice-id="historyDetailInvoiceId"
      @close="historyDetailInvoiceId=''"
      @changed="load"
    />

    <div v-if="showVendors" class="modal-overlay"><div class="modal modal-lg">
      <div class="modal-header"><h3>Manage Vendors <span class="bn-hint">— ভেন্ডার তালিকা</span></h3><button class="modal-close" @click="showVendors=false">×</button></div>
      <div class="modal-body"><div class="vendor-add"><input v-model="newVendor.name" placeholder="Name"><input v-model="newVendor.phone" placeholder="Phone"><button class="btn btn-primary" @click="addVendor">Add</button></div><div class="table-scroll"><table><thead><tr><SortableHeader table-id="pos-vendors" column="name">Name</SortableHeader><SortableHeader table-id="pos-vendors" column="phone">Phone</SortableHeader><SortableHeader table-id="pos-vendors" column="currentDue" type="number" class="num">Due</SortableHeader><SortableHeader table-id="pos-vendors" column="status">Status</SortableHeader><th></th></tr></thead><tbody><tr v-for="v in $sortRows('pos-vendors', vendorsAll)" :key="v.id"><td>{{v.name}}</td><td>{{v.phone}}</td><td class="num">{{money(v.currentDue)}}</td><td>{{v.status}}</td><td><button class="btn btn-sm" @click="toggleVendor(v)">{{v.status==='Inactive'?'Activate':'Deactivate'}}</button></td></tr></tbody></table></div></div>
    </div></div>
  </section>
</template>

<style scoped>
.gas-pos{display:grid;gap:14px;font-size:13px}
.start-session-card{display:grid;grid-template-columns:minmax(260px,1fr) 180px minmax(180px,1fr) auto;gap:10px;align-items:end;margin:0}
.session-copy h3{margin:0 0 4px;font-size:15px}.session-copy p{margin:0;color:var(--color-text-muted,#64748b);font-size:12px;line-height:1.45}.bn-hint{display:inline;color:var(--color-text-muted,#64748b);font-weight:400}
.session-banner{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--color-success-light,#ecfdf3);border:1px solid #b7e4d3;border-radius:9px}.session-banner>div{white-space:nowrap}.session-banner strong{margin-left:5px}.update-banner{background:var(--color-warning-light,#fff7e8);border-color:#f3dcb3}
.pos-layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(390px,1fr);gap:20px;align-items:start}.product-card-panel,.checkout-card{margin:0;min-width:0}.pos-search-wrap{position:relative;margin:4px 0 10px}.pos-search{max-width:none!important;margin:0!important;padding-right:40px!important}.pos-search::-webkit-search-cancel-button{display:none}.pos-search-clear{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--color-text-muted,#64748b);font-size:20px;line-height:1;cursor:pointer}.pos-search-clear:hover{background:var(--color-surface-muted,#f1f5f9);color:var(--color-text,#0f172a)}
.category-filter{display:flex;gap:7px;overflow-x:auto;overflow-y:hidden;padding:2px 1px 9px;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-inline:contain}.category-filter::-webkit-scrollbar{display:none}.category-chip{flex:0 0 auto;border:1px solid var(--color-border,#dbe3ef);background:var(--color-surface,#fff);color:var(--color-text,#0f172a);border-radius:999px;padding:7px 13px;font:inherit;font-size:12px;font-weight:600;line-height:1.15;cursor:pointer;white-space:nowrap;min-height:34px}.category-chip:hover{border-color:var(--color-primary,#2563eb);color:var(--color-primary,#2563eb)}.category-chip.active{background:var(--color-primary,#2563eb);border-color:var(--color-primary,#2563eb);color:#fff}
.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;max-height:60vh;overflow-y:auto;padding:2px}
.product-tile{border:1px solid var(--color-border,#dbe3ef);border-radius:8px;padding:12px 10px;background:var(--color-surface,#fff);cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:6px;min-height:92px}.product-tile:hover,.product-tile.is-highlighted{border-color:var(--color-primary,#2563eb);box-shadow:0 2px 8px rgba(15,23,42,.08);background:var(--color-primary-soft,#eff6ff)}.p-name{font-size:13px;font-weight:700;line-height:1.3}.p-price{font-family:var(--font-mono,monospace);font-size:13px;color:var(--color-primary,#2563eb);font-weight:800}.p-stock{font-size:11px;color:var(--color-text-muted,#64748b)}.p-stock.danger{color:var(--color-danger,#dc2626);font-weight:700}
.reprint-row{display:flex;justify-content:flex-end;gap:7px;margin-top:14px}.reprint-row input{width:180px}
.field-gap{height:8px}.customer-actions{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:8px 0}.customer-more{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.due-old{margin-top:6px;color:var(--color-danger,#dc2626)}
.cart-title{margin:16px 0 10px;border-top:1px solid var(--color-border,#dbe3ef);padding-top:16px;font-size:15px}.cart-list{display:flex;flex-direction:column;gap:8px;max-height:36vh;overflow-y:auto;margin-bottom:12px}.cart-empty{padding:18px 8px}
.cart-row{display:grid;grid-template-columns:minmax(120px,1fr) 60px 90px 90px 28px;gap:8px;align-items:center}.c-name{font-size:13px;font-weight:600;min-width:0}.c-name strong{display:block;overflow:hidden;text-overflow:ellipsis}.cart-meta{font-size:11px;color:var(--color-text-muted,#64748b);font-weight:400}.cart-row input{padding:6px 8px!important;text-align:center}.c-line-total{font-family:var(--font-mono,monospace);font-size:13px;text-align:right}.cart-remove{border:none;background:transparent;color:var(--color-danger,#dc2626);cursor:pointer;font-size:18px}
.c-cost{border:none;background:transparent;padding:0 3px;margin-left:2px;cursor:pointer;font-family:var(--font-mono,monospace);font-size:11px;line-height:1;color:var(--color-text-muted,#64748b);opacity:.45;border-radius:4px}.c-cost:hover{opacity:.8}.c-cost.is-revealed{opacity:1;padding:1px 5px;font-weight:700;background:#f1f5f9;color:#0f172a}
.shortage-row{padding:8px 10px;background:var(--color-danger-light,#fff1f2);border-radius:8px;margin-top:-2px}.shortage-head{display:flex;justify-content:space-between;gap:8px;color:#9f1239;font-size:11px}.shortage-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.shortage-actions .active{background:var(--color-primary,#2563eb);border-color:var(--color-primary,#2563eb);color:#fff}.vendor-source{display:grid;grid-template-columns:minmax(130px,1fr) 100px auto;gap:6px;margin-top:7px}
.totals-row{display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:4px 0}.totals-row.grand{font-size:18px;font-weight:800;border-top:1px solid var(--color-border,#dbe3ef);padding-top:10px;margin-top:6px}.total-input{width:100px!important;text-align:right}.received-label{display:block;margin-top:12px}.change{color:#07833f}.due{color:var(--color-danger,#dc2626)}
.payment-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:8px}.payment-method-field,.bank-account-field{flex:1;min-width:150px}.bank-account-field small{display:block;color:var(--color-danger,#dc2626);font-size:10px;margin-top:4px}.complete-btn{width:100%;margin-top:14px}
.complete-btn.complete-sale-animated{position:relative;overflow:hidden;transition:transform .16s ease,background-color .18s ease,border-color .18s ease,box-shadow .18s ease}.complete-btn.complete-sale-animated:not(:disabled):active{transform:scale(.985)}.complete-btn.complete-sale-animated.is-loading{cursor:wait}.complete-btn.complete-sale-animated.is-success{background:#15803d;border-color:#15803d}.complete-btn.complete-sale-animated.is-error{background:var(--color-danger,#dc2626);border-color:var(--color-danger,#dc2626)}.complete-sale-content{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:20px}.complete-sale-spinner{width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:complete-sale-spin .7s linear infinite}.complete-sale-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;font-size:17px;font-weight:800;line-height:1}.complete-sale-state-enter-active,.complete-sale-state-leave-active{transition:opacity .16s ease,transform .16s ease,filter .16s ease}.complete-sale-state-enter-from{opacity:0;transform:translateY(8px);filter:blur(3px)}.complete-sale-state-leave-to{opacity:0;transform:translateY(-8px);filter:blur(3px)}@keyframes complete-sale-spin{to{transform:rotate(360deg)}}
.vendor-add{display:grid;grid-template-columns:1fr 180px auto;gap:8px;margin-bottom:10px}
.tracked-shortage-note{font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:7px 9px}.cart-tracking-row{margin:-2px 0 8px;padding:8px 10px;border:1px dashed var(--color-border,#dbe3ef);border-radius:8px;background:var(--color-surface-muted,#f8fafc);display:flex;align-items:center;justify-content:space-between;gap:10px}.cart-tracking-row>div{display:grid;gap:2px}.serial-option-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:55vh;overflow:auto}.serial-option{border:1px solid var(--color-border,#dbe3ef);border-radius:9px;background:var(--color-surface,#fff);padding:10px;text-align:left;display:grid;gap:3px;cursor:pointer}.serial-option.selected{border-color:var(--color-primary,#2563eb);background:var(--color-primary-soft,#eff6ff);box-shadow:0 0 0 1px var(--color-primary,#2563eb) inset}.serial-option small{color:var(--color-text-muted,#64748b)}.serial-picker-count{margin-right:auto;font-weight:700}.serial-picker-modal{max-width:720px!important}@media(max-width:620px){.serial-option-grid{grid-template-columns:1fr}.tracked-shortage-note{font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:7px 9px}.cart-tracking-row{align-items:stretch;flex-direction:column}.cart-tracking-row .btn{width:100%}}
.invoice-modal{max-width:980px!important}.invoice-modal-body{background:#eef2f7;padding:18px}.invoice-paper-host{width:fit-content;max-width:100%;margin:0 auto;background:#fff}.invoice-paper{font-family:"Noto Sans Bengali","SolaimanLipi","Kalpurush","Siyam Rupali",Arial,sans-serif;color:#16191a;background:#fff;line-height:1.45;font-variant-numeric:tabular-nums}.invoice-page{box-sizing:border-box;width:100%;max-width:190mm;min-height:277mm;margin:0 auto;padding:3mm 12mm 6mm;background:#fff;display:flex;flex-direction:column;gap:2mm;box-shadow:0 0 0 1px #e2e5e6;position:relative}.inv-header-block{display:flex;flex-direction:column;gap:1.5mm}.inv-bismillah{text-align:center;font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.inv-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;border-bottom:1.3px solid #16191a;padding-bottom:1mm}.inv-header-brand{display:flex;gap:3.5mm;align-items:flex-start;min-width:0}.inv-logo{max-height:22mm;max-width:32mm;width:auto;height:auto;object-fit:contain;flex-shrink:0}.inv-shop-name{margin:0;font-size:22px;font-weight:700;line-height:1.2}.inv-proprietor{font-size:12.5px;font-weight:600;margin-top:.1mm}.inv-proprietor-paragraph{display:block;font-size:11px;line-height:1.4;color:#6b7375;margin-top:.5mm;max-width:92mm;white-space:pre-wrap}.inv-shop-desc{font-size:11.5px;color:#6b7375;margin-top:1mm;max-width:92mm;white-space:pre-wrap}.inv-header-side{text-align:right;font-size:11.5px;color:#6b7375;flex-shrink:0}.inv-header-side .inv-address{max-width:60mm;margin-left:auto;white-space:pre-line}.inv-header-side .inv-phone{color:#16191a;font-weight:600}.inv-customer-info-row{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm}.inv-info-row{display:flex;flex-direction:column;align-items:flex-end;gap:1mm;font-size:12.5px;text-align:right;flex-shrink:0}.inv-customer{font-size:12.5px;min-width:0}.inv-customer-name{font-size:14.5px;font-weight:700}.inv-customer-meta{display:flex;flex-wrap:wrap;gap:1mm 6mm;color:#6b7375;margin-top:.5mm}.inv-table{width:100%;border-collapse:collapse;font-size:12px;margin:0}.inv-table th{text-align:left;font-size:12.5px;font-weight:700;color:#16191a;padding:1.5mm 2mm;border-top:1px solid #16191a;border-bottom:1px solid #d7dcdf}.inv-table th.num,.inv-table td.num{text-align:right}.inv-table td{padding:0 2mm;height:22px;border-bottom:1px solid #e2e5e6;vertical-align:middle}.inv-table td.idx{color:#8a9294;width:8mm}.inv-table td.name{word-break:break-word}.inv-bottom{display:flex;justify-content:space-between;gap:8mm}.inv-side{display:flex;flex-direction:column;gap:3mm;max-width:92mm}.inv-side-label{font-size:9px;font-weight:700;color:#6b7375;margin-bottom:1mm}.inv-payment-methods{display:flex;flex-wrap:wrap;gap:2mm}.inv-payment-chip{border:1px solid #d9dee1;padding:1.2mm 2.6mm;font-size:11px;color:#6b7375}.inv-terms{margin:0;padding-left:5mm;font-size:11px;color:#6b7375;line-height:1.5}.inv-totals{width:60mm;flex-shrink:0}.inv-total-row{display:flex;justify-content:space-between;padding:1.5mm 0;font-size:12.5px;border-bottom:1px solid #e2e5e6}.inv-total-row .v{font-weight:600}.inv-total-row.grand{align-items:baseline}.inv-total-row.grand .v{font-size:18px;font-weight:700}.inv-total-row.due{border-bottom:2px solid #16191a;font-weight:700}.inv-words{font-size:12px;text-align:left;padding-top:3px}.inv-footer-block{display:flex;flex-direction:column;gap:2mm;margin-top:8mm}.inv-signatures{display:flex;justify-content:space-between;gap:16mm}.inv-signature{flex:1;border-top:1px solid #16191a;padding-top:1.5mm;font-size:11.5px;text-align:center}.inv-footer-text{text-align:center;font-size:10.5px;color:#8a9294;border-top:1px solid #e2e5e6;padding-top:1.5mm}.invoice-actions{position:sticky;bottom:0;background:#fff;z-index:2}.invoice-paper.thermal .invoice-page{width:72mm;max-width:72mm;min-height:0;margin:0 auto;padding:4mm;font-size:11px;box-shadow:none;gap:2mm}.invoice-paper.thermal.size-58 .invoice-page{width:48mm;max-width:48mm}.invoice-paper.thermal .inv-header{display:block;text-align:center}.invoice-paper.thermal .inv-header-brand{display:block}.invoice-paper.thermal .inv-header-side{text-align:center;margin-top:2mm}.invoice-paper.thermal .inv-header-side .inv-address{max-width:none;margin:auto}.invoice-paper.thermal .inv-customer-info-row{flex-direction:column;align-items:flex-start;gap:1.5mm}.invoice-paper.thermal .inv-info-row{align-items:flex-start;text-align:left}.invoice-paper.thermal .inv-shop-name{font-size:16px}.invoice-paper.thermal .inv-proprietor-paragraph,.invoice-paper.thermal .inv-shop-desc{max-width:none}.invoice-paper.thermal .inv-table{font-size:9px}.invoice-paper.thermal .inv-table th,.invoice-paper.thermal .inv-table td{padding-left:1mm;padding-right:1mm}.invoice-paper.thermal .inv-table th:nth-child(4),.invoice-paper.thermal .inv-table td:nth-child(4){display:none}.invoice-paper.thermal .inv-bottom{flex-direction:column;gap:3mm}.invoice-paper.thermal .inv-totals{width:auto}.invoice-paper.thermal .inv-signatures{gap:6mm}.invoice-paper.thermal .inv-side{max-width:none}.invoice-paper.thermal .inv-footer-block{margin-top:4mm}
@media(max-width:1050px){.pos-layout{grid-template-columns:minmax(0,1.2fr) minmax(360px,1fr);gap:12px}.start-session-card{grid-template-columns:1fr 150px 1fr auto}}
@media(max-width:900px){.start-session-card{grid-template-columns:1fr 1fr}.session-copy{grid-column:1/-1}.pos-layout{grid-template-columns:1fr}.product-grid{max-height:40vh}.checkout-card{position:static}.cart-list{max-height:none}}
@media(max-width:620px){.gas-pos{gap:8px;font-size:12px}.product-card-panel,.checkout-card{padding:12px}.start-session-card{grid-template-columns:1fr}.session-banner{gap:8px;padding:9px 10px}.session-banner>div{width:calc(50% - 4px);white-space:normal}.session-banner .toolbar-spacer{display:none}.category-filter{margin-inline:-2px;padding-bottom:8px}.category-chip{min-height:36px;padding:8px 13px;font-size:12px}.product-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;max-height:44vh}.product-tile{padding:9px;min-height:82px}.customer-actions{display:grid;grid-template-columns:1fr;gap:6px}.customer-actions .btn{width:100%}.customer-more{grid-template-columns:1fr}.cart-list{gap:10px}.cart-row{grid-template-columns:minmax(0,1fr) 62px 82px 74px 24px;gap:5px}.cart-row input{padding:6px 4px!important;min-width:0}.vendor-source{grid-template-columns:1fr 90px}.vendor-source .btn{grid-column:1/-1}.payment-row{display:grid;grid-template-columns:1fr}.payment-method-field,.bank-account-field{min-width:0}.reprint-row{display:none}.complete-btn{min-height:44px}.totals-row.grand{font-size:17px}}
@media(max-width:460px){.session-banner>div{width:100%}.product-card-panel,.checkout-card{padding:10px}.product-grid{gap:6px}.product-tile{min-height:78px;padding:8px}.p-name{font-size:12px}.cart-row{grid-template-columns:minmax(0,1fr) 66px 84px 26px;grid-template-areas:'name name name remove' 'qty price total total';gap:6px 5px;padding:8px;border:1px solid var(--color-border,#dbe3ef);border-radius:8px}.c-name{grid-area:name}.cart-qty{grid-area:qty}.cart-price{grid-area:price}.c-line-total{grid-area:total;align-self:center}.cart-remove{grid-area:remove;align-self:start}.shortage-row{margin-top:-5px}.totals-row{gap:10px}.total-input{width:92px!important}}
@media(prefers-reduced-motion:reduce){.complete-btn.complete-sale-animated,.complete-sale-state-enter-active,.complete-sale-state-leave-active{transition:none}.complete-sale-spinner{animation-duration:1.2s}}
@media print{
  :global(html),:global(body){margin:0!important;padding:0!important;min-height:0!important;height:auto!important;overflow:visible!important;background:#fff!important}
  :global(body *){visibility:hidden!important}
  .invoice-overlay,.invoice-overlay *{visibility:visible!important}
  .invoice-overlay{position:static!important;inset:auto!important;width:auto!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:visible!important;background:#fff!important;display:block!important}
  .invoice-overlay .modal{position:static!important;max-width:none!important;width:100%!important;height:auto!important;min-height:0!important;overflow:visible!important;box-shadow:none!important;border:0!important;margin:0!important;padding:0!important}
  .invoice-overlay .modal-header,.invoice-overlay .modal-footer{display:none!important}
  .invoice-modal-body{padding:0!important;margin:0!important;background:#fff!important;overflow:visible!important}
  .invoice-paper{box-shadow:none!important;margin:0 auto!important;height:auto!important;min-height:0!important;overflow:visible!important}
  .invoice-page{box-shadow:none!important;margin:0 auto!important;break-inside:avoid!important;page-break-inside:avoid!important}
  .invoice-paper:not(.thermal) .invoice-page{min-height:270mm!important}
  .invoice-paper:not(.thermal) .inv-footer-block{margin-top:8mm!important}
  .invoice-paper.thermal .invoice-page{min-height:0!important;height:auto!important}
  .invoice-paper.thermal .inv-footer-block{margin-top:4mm!important}
  .inv-signatures{break-inside:avoid!important;page-break-inside:avoid!important}
  @page{margin:8mm}
}

/* SherERP_Vue POS catalogue/cart layout port — styles deliberately stay scoped.
   Business logic, cart state, prices, invoice printing, serials and FIFO are unchanged. */
.gas-pos{gap:var(--sher-space-3);font-size:var(--sher-text-base)}
.gas-pos .start-session-card{border-color:var(--sher-line);border-radius:var(--sher-radius-lg);background:var(--sher-raised);box-shadow:none;padding:var(--sher-card-pad)}
.gas-pos .session-copy h3{font-size:var(--sher-text-md);font-weight:600}
.gas-pos .session-copy p{color:var(--sher-text-muted);font-size:var(--sher-text-sm)}
.gas-pos .session-banner{gap:12px;border:1px solid var(--sher-ok-line);border-radius:var(--sher-radius-lg);padding:10px 14px;background:var(--sher-ok-bg);color:var(--sher-text);font-size:var(--sher-text-sm)}
.gas-pos .session-banner.update-banner{background:var(--sher-warn-bg);border-color:var(--sher-warn-line)}
.pos-search-bar{display:flex;align-items:center;gap:12px;min-width:0;padding:8px 14px;border:1px solid var(--sher-line);border-radius:var(--sher-radius-lg);background:var(--sher-raised)}
.pos-search-label{flex:0 0 auto;min-width:120px;margin:0;color:var(--sher-text);font-size:var(--sher-text-sm);font-weight:600}
.pos-search-label .bn-hint{display:block;font-size:var(--sher-text-2xs)}
.pos-search-bar .pos-search-wrap{position:relative;flex:1;min-width:0;margin:0;display:flex;align-items:center}
.pos-search-icon{position:absolute;left:13px;color:var(--sher-text-faint);font-size:24px;line-height:1;pointer-events:none}
.pos-search-bar .pos-search{width:100%;height:36px;padding:6px 40px 6px 41px!important;border:1px solid var(--sher-line-strong);border-radius:var(--sher-radius);background:var(--sher-raised);color:var(--sher-text);font-size:14px}
.pos-search-bar:focus-within{border-color:var(--sher-primary);box-shadow:0 0 0 2px var(--sher-primary-soft)}
.pos-search-bar .pos-search-clear{right:8px;border-radius:999px;background:var(--sher-sunken);color:var(--sher-text-muted)}
.gas-pos .pos-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,27rem);gap:var(--sher-space-3);align-items:start}
.gas-pos .product-card-panel,.gas-pos .checkout-card{margin:0;min-width:0;padding:var(--sher-card-pad);border:1px solid var(--sher-line);border-radius:var(--sher-radius-lg);background:var(--sher-raised);box-shadow:none}
.gas-pos .checkout-card{position:sticky;top:8px}
.pos-catalogue-tools{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;min-width:0}
.pos-catalogue-tools .category-filter{flex:1;min-width:0;margin:0;padding:2px 0 4px;gap:6px}
.gas-pos .category-chip{min-height:30px;padding:5px 12px;border:1px solid var(--sher-line);border-radius:9999px;background:var(--sher-raised);color:var(--sher-text);font-size:var(--sher-text-sm);font-weight:500}
.gas-pos .category-chip:hover{background:var(--sher-hover)}
.gas-pos .category-chip.active{background:var(--sher-primary);color:var(--sher-on-primary);border-color:var(--sher-primary)}
.pos-view-toggle{display:flex;flex:0 0 auto;gap:2px;padding:2px;border:1px solid var(--sher-line);border-radius:var(--sher-radius);background:var(--sher-sunken)}
.pos-view-toggle button{border:0;border-radius:6px;background:transparent;color:var(--sher-text-muted);padding:5px 9px;font:500 var(--sher-text-xs)/1.4 var(--sher-font);cursor:pointer}
.pos-view-toggle button.active{background:var(--sher-raised);color:var(--sher-text);box-shadow:var(--sher-shadow)}
.gas-pos .product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(9rem,1fr));gap:8px;padding:1px;max-height:60vh}
.gas-pos .product-tile{min-width:0;min-height:0;padding:8px;gap:5px;border-color:var(--sher-line);border-radius:var(--sher-radius-md);background:var(--sher-raised);color:var(--sher-text);transition:border-color 120ms ease,box-shadow 120ms ease}
.gas-pos .product-tile:hover,.gas-pos .product-tile.is-highlighted{background:var(--sher-raised);border-color:var(--sher-primary);box-shadow:0 0 0 2px var(--sher-primary-soft)}
.p-image{display:grid;place-items:center;width:100%;height:54px;border-radius:var(--sher-radius);background:var(--sher-sunken);color:var(--sher-text-faint);font-size:17px;font-weight:700}
.gas-pos .p-name{font-weight:600;font-size:var(--sher-text-sm);line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gas-pos .p-price{font-family:var(--sher-font);font-size:var(--sher-text-base);font-weight:700;color:var(--sher-text)}
.gas-pos .p-stock{font-size:11px;color:var(--sher-ok);background:var(--sher-ok-bg);border-radius:9999px;padding:2px 7px;align-self:flex-start}
.gas-pos .p-stock.danger{color:var(--sher-bad);background:var(--sher-bad-bg)}
.gas-pos .product-grid.is-list{grid-template-columns:minmax(0,1fr)}
.gas-pos .is-list .product-tile{display:grid;grid-template-columns:46px minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;gap:2px 12px;padding:9px 12px}
.gas-pos .is-list .p-image{grid-row:1/3;width:46px;height:46px;font-size:14px}
.gas-pos .is-list .p-name{grid-column:2;grid-row:1;font-size:14px}
.gas-pos .is-list .p-stock{grid-column:2;grid-row:2;justify-self:start}
.gas-pos .is-list .p-price{grid-column:3;grid-row:1/3;white-space:nowrap;font-size:15px}
.gas-pos .cart-title{margin:14px 0 8px;padding:12px 0 0;border-top:1px solid var(--sher-line);font-size:var(--sher-text-md);font-weight:600}
.gas-pos .customer-actions .btn{min-height:30px;padding:5px 9px;border:0;background:transparent;color:var(--sher-primary-text);font-size:var(--sher-text-xs);font-weight:600}
.gas-pos .customer-actions .btn:hover{text-decoration:underline;background:transparent}
.gas-pos .cart-list{gap:0;max-height:38vh}
.gas-pos .cart-row{grid-template-columns:minmax(0,1fr) 60px 86px 82px 26px;gap:5px;padding:8px 0;border-bottom:1px solid var(--sher-line-soft)}
.gas-pos .c-name{font-weight:600;font-size:var(--sher-text-sm)}
.gas-pos .cart-row input{min-width:0;height:34px;padding:5px 6px!important;border-color:var(--sher-line-strong);border-radius:var(--sher-radius-sm)}
.gas-pos .c-line-total,.gas-pos .c-cost{font-family:var(--sher-font);font-variant-numeric:normal}
.gas-pos .c-cost.is-revealed{background:var(--sher-text);color:var(--sher-raised)}
.gas-pos .cart-remove{color:var(--sher-bad);width:26px;height:34px}
.gas-pos .totals-row{font-size:var(--sher-text-sm);padding:5px 0}
.gas-pos .totals-row.grand{font-size:15px;font-weight:700;border-color:var(--sher-line)}
.gas-pos .totals-row.grand strong{color:var(--sher-primary-text);font-size:22px}
.gas-pos .totals-row.due{color:var(--sher-bad)}
.gas-pos .totals-row.change{color:var(--sher-ok)}
.gas-pos .complete-btn{min-height:48px;border-radius:var(--sher-radius-md);font-size:15px;font-weight:700}
.gas-pos .shortage-row{background:var(--sher-bad-bg);border:1px solid var(--sher-bad-line);border-radius:var(--sher-radius);margin-top:5px}
.gas-pos .shortage-head{color:var(--sher-bad)}
.gas-pos .cart-tracking-row{background:var(--sher-sunken);border-color:var(--sher-line)}
@media(max-width:1088px){
 .gas-pos .pos-layout{grid-template-columns:minmax(0,1fr)}
 .gas-pos .checkout-card{position:static}
 .gas-pos .product-grid{max-height:42vh}
 .gas-pos .cart-list{max-height:none}
}
@media(max-width:640px){
 .pos-search-bar{padding:9px 11px}
 .pos-search-label{display:none}
 .pos-search-bar .pos-search{height:40px}
 .pos-catalogue-tools{gap:6px;align-items:flex-start}
 .pos-view-toggle button{padding:5px 6px}
 .gas-pos .product-grid{grid-template-columns:repeat(2,minmax(0,1fr));max-height:44vh;gap:7px}
 .gas-pos .product-grid.is-list{grid-template-columns:minmax(0,1fr)}
 .gas-pos .product-card-panel,.gas-pos .checkout-card{padding:12px}
 .gas-pos .customer-actions{display:flex;gap:6px}
 .gas-pos .customer-actions .btn{width:auto;min-height:36px}
 .gas-pos .cart-row{grid-template-columns:minmax(0,1fr) 62px 80px 72px 24px;gap:5px}
}
@media(max-width:460px){
 .gas-pos .product-card-panel,.gas-pos .checkout-card{padding:10px}
 .gas-pos .cart-row{display:grid;grid-template-columns:minmax(0,1fr) 66px 84px 26px;grid-template-areas:'name name name remove' 'qty price total total';padding:8px;border:1px solid var(--sher-line);border-radius:var(--sher-radius)}
 .gas-pos .cart-row input{min-width:0}
 .gas-pos .p-name{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
 .pos-catalogue-tools .category-filter{max-width:calc(100% - 110px)}
}
@media print{.pos-search-bar,.pos-view-toggle{display:none!important}}
</style>
