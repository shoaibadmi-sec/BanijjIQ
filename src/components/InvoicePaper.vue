<script setup lang="ts">
import { computed } from 'vue';
import type { PosInvoice } from '../types';

const props = defineProps<{
  invoice: PosInvoice;
  settings: Record<string,string>;
  logoDataUri?: string;
  mode?: 'a4'|'thermal';
}>();

function settingBool(v:unknown){ return v===true || String(v??'').trim().toLowerCase()==='true'; }
function parseArray<T>(raw:unknown,fallback:T[]):T[]{ try{const x=JSON.parse(String(raw||'[]'));return Array.isArray(x)?x as T[]:fallback;}catch{return fallback;} }
const design = computed(()=>({
  shopNameBangla:props.settings['Shop Name Bangla']||props.settings['Shop Name']||'SherERP',
  invoiceTitle:props.settings['Invoice Title']||'চালান',
  shopDescription:props.settings['Shop Description']||'',
  proprietorName:props.settings['Invoice Proprietor Name']||'',
  proprietorParagraph:props.settings['Invoice Proprietor Paragraph']||'',
  address:props.settings['Address']||'',
  phone1:props.settings['Phone 1']||'',
  phone2:props.settings['Phone 2']||'',
  showBismillah:settingBool(props.settings['Invoice Show Bismillah']),
  bismillahText:props.settings['Invoice Bismillah Text']||'بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ',
  paymentMethods:parseArray<{label:string;value:string}>(props.settings['Invoice Payment Methods'],[]),
  terms:parseArray<string>(props.settings['Invoice Terms'],[]),
  footer:props.settings['Invoice Footer']||'',
  receiptSize:props.settings['Receipt Size']||'80mm',
  showSignature:settingBool(props.settings['Invoice Show Signature']),
  currency:props.settings['Currency Symbol']||'৳',
}));
function toBn(value:unknown){ return String(value??'').replace(/\d/g,d=>'০১২৩৪৫৬৭৮৯'[Number(d)]); }
function formatQty(v:number){ const n=Math.round(Number(v||0)); return n.toLocaleString(); }
const bnMonths=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
function invoiceDateBn(v:string){ const d=new Date(`${v}T00:00:00`); return Number.isNaN(d.getTime())?toBn(v):`${toBn(d.getDate())} ${bnMonths[d.getMonth()]} ${toBn(d.getFullYear())}`; }
const bnWords=['শূন্য','এক','দুই','তিন','চার','পাঁচ','ছয়','সাত','আট','নয়','দশ','এগারো','বারো','তেরো','চৌদ্দ','পনের','ষোল','সতের','আঠারো','ঊনিশ','বিশ','একুশ','বাইশ','তেইশ','চব্বিশ','পঁচিশ','ছাব্বিশ','সাতাশ','আঠাশ','ঊনত্রিশ','ত্রিশ','একত্রিশ','বত্রিশ','তেত্রিশ','চৌত্রিশ','পঁয়ত্রিশ','ছত্রিশ','সাঁইত্রিশ','আটত্রিশ','ঊনচল্লিশ','চল্লিশ','একচল্লিশ','বিয়াল্লিশ','তেতাল্লিশ','চুয়াল্লিশ','পঁয়তাল্লিশ','ছেচল্লিশ','সাতচল্লিশ','আটচল্লিশ','ঊনপঞ্চাশ','পঞ্চাশ','একান্ন','বায়ান্ন','তিপ্পান্ন','চুয়ান্ন','পঞ্চান্ন','ছাপ্পান্ন','সাতান্ন','আটান্ন','ঊনষাট','ষাট','একষট্টি','বাষট্টি','তেষট্টি','চৌষট্টি','পঁয়ষট্টি','ছেষট্টি','সাতষট্টি','আটষট্টি','ঊনসত্তর','সত্তর','একাত্তর','বাহাত্তর','তিয়াত্তর','চুয়াত্তর','পঁচাত্তর','ছিয়াত্তর','সাতাত্তর','আটাত্তর','ঊনআশি','আশি','একাশি','বিরাশি','তিরাশি','চুরাশি','পঁচাশি','ছিয়াশি','সাতাশি','আটাশি','ঊননব্বই','নব্বই','একানব্বই','বিরানব্বই','তিরানব্বই','চুরানব্বই','পঁচানব্বই','ছিয়ানব্বই','সাতানব্বই','আটানব্বই','নিরানব্বই'];
function bnAmountWords(amount:number){ let n=Math.round(Number(amount)||0); if(n<=0)return ''; const out:string[]=[]; const push=(x:number,label:string)=>{if(x)out.push(`${bnWords[x]||toBn(x)} ${label}`)}; const crore=Math.floor(n/10000000);n%=10000000; const lakh=Math.floor(n/100000);n%=100000; const thousand=Math.floor(n/1000);n%=1000; const hundred=Math.floor(n/100);n%=100; push(crore,'কোটি');push(lakh,'লক্ষ');push(thousand,'হাজার');push(hundred,'শত');if(n)out.push(bnWords[n]||toBn(n)); return `${out.join(' ')} টাকা মাত্র`; }
function invoiceMoneyBn(v:number){ return `${design.value.currency}${toBn(Math.round(Number(v||0)).toLocaleString('en-US'))}`; }
</script>

<template>
  <div class="invoice-paper" :class="[mode==='thermal'?'thermal':'', mode==='thermal'?'size-'+design.receiptSize.replace('mm',''):'']">
    <div class="invoice-page">
      <div class="inv-header-block">
        <div v-if="design.showBismillah&&design.bismillahText" class="inv-bismillah">{{design.bismillahText}}</div>
        <header class="inv-header">
          <div class="inv-header-brand">
            <img v-if="logoDataUri" :src="logoDataUri" class="inv-logo" alt="Logo">
            <div>
              <h1 class="inv-shop-name">{{design.shopNameBangla}}</h1>
              <div v-if="design.proprietorName" class="inv-proprietor">প্রোপাইটর: {{design.proprietorName}}</div>
              <em v-if="design.proprietorParagraph" class="inv-proprietor-paragraph">{{design.proprietorParagraph}}</em>
              <div v-if="design.shopDescription" class="inv-shop-desc">{{design.shopDescription}}</div>
            </div>
          </div>
          <div class="inv-header-side">
            <div v-if="design.address" class="inv-address">{{design.address}}</div>
            <div v-if="design.phone1" class="inv-phone">মোবাইল: {{toBn(design.phone1)}}</div>
            <div v-if="design.phone2" class="inv-phone">মোবাইল: {{toBn(design.phone2)}}</div>
          </div>
        </header>
        <div class="inv-customer-info-row">
          <div class="inv-customer">
            <div class="inv-customer-name">নামঃ {{invoice.customerName||'খুচরা ক্রেতা'}}</div>
            <div class="inv-customer-meta">
              <span v-if="invoice.customerFatherName">পিতা: {{invoice.customerFatherName}}</span>
              <span v-if="invoice.customerPhone">মোবাইল: {{toBn(invoice.customerPhone)}}</span>
              <span v-if="invoice.customerAddress">ঠিকানা: {{invoice.customerAddress}}</span>
            </div>
          </div>
          <div class="inv-info-row">
            <span><b>{{design.invoiceTitle}} নং</b> : {{invoice.invoiceId}}</span>
            <span><b>তারিখ</b> : {{invoiceDateBn(invoice.date)}}</span>
          </div>
        </div>
      </div>
      <table class="inv-table"><thead><tr><th>নং</th><th>পণ্যের নাম</th><th class="num">পরিমাণ</th><th>একক</th><th class="num">দর</th><th class="num">টাকা</th></tr></thead><tbody>
        <tr v-for="(i,idx) in invoice.items" :key="i.productId"><td class="idx">{{toBn(idx+1)}}</td><td class="name">{{i.productName}}</td><td class="num">{{toBn(formatQty(i.quantity))}}</td><td>{{i.unit||''}}</td><td class="num">{{invoiceMoneyBn(i.unitPrice)}}</td><td class="num">{{invoiceMoneyBn(i.lineTotal)}}</td></tr>
      </tbody></table>
      <div class="inv-bottom">
        <div class="inv-side">
          <div v-if="design.paymentMethods.length"><div class="inv-side-label">সেন্ড-মানি</div><div class="inv-payment-methods"><div v-for="m in design.paymentMethods" :key="m.label+'-'+m.value" class="inv-payment-chip">{{m.label}} {{m.value}}</div></div></div>
          <div v-if="design.terms.length"><div class="inv-side-label">শর্তাবলী</div><ol class="inv-terms"><li v-for="t in design.terms" :key="t">{{t}}</li></ol></div>
        </div>
        <div class="inv-totals">
          <div class="inv-total-row"><span>সাব-টোটাল</span><span class="v">{{invoiceMoneyBn(invoice.subtotal)}}</span></div>
          <div v-if="invoice.discount>0" class="inv-total-row"><span>ডিসকাউন্ট</span><span class="v">− {{invoiceMoneyBn(invoice.discount)}}</span></div>
          <div class="inv-total-row grand"><span>সর্বমোট</span><span class="v">{{invoiceMoneyBn(invoice.grandTotal)}}</span></div>
          <div v-if="invoice.paidAmount>0" class="inv-total-row"><span>পরিশোধ</span><span class="v">− {{invoiceMoneyBn(invoice.paidAmount)}}</span></div>
          <div v-if="invoice.dueAmount>0" class="inv-total-row due"><span>বকেয়া</span><span class="v">{{invoiceMoneyBn(invoice.dueAmount)}}</span></div>
          <div class="inv-words">কথায়ঃ {{bnAmountWords(invoice.grandTotal)}}</div>
        </div>
      </div>
      <div class="inv-footer-block">
        <div v-if="design.showSignature" class="inv-signatures"><div class="inv-signature">ক্রেতার স্বাক্ষর</div><div class="inv-signature">বিক্রেতার স্বাক্ষর</div></div>
        <div v-if="design.footer" class="inv-footer-text">{{design.footer}}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.invoice-paper{font-family:"Noto Sans Bengali","SolaimanLipi","Kalpurush","Siyam Rupali",Arial,sans-serif;color:#16191a;background:#fff;line-height:1.45;font-variant-numeric:tabular-nums}.invoice-page{box-sizing:border-box;width:100%;max-width:190mm;min-height:277mm;margin:0 auto;padding:3mm 12mm 6mm;background:#fff;display:flex;flex-direction:column;gap:2mm;box-shadow:0 0 0 1px #e2e5e6;position:relative}.inv-header-block{display:flex;flex-direction:column;gap:1.5mm}.inv-bismillah{text-align:center;font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.inv-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;border-bottom:1.3px solid #16191a;padding-bottom:1mm}.inv-header-brand{display:flex;gap:3.5mm;align-items:flex-start;min-width:0}.inv-logo{max-height:22mm;max-width:32mm;width:auto;height:auto;object-fit:contain;flex-shrink:0}.inv-shop-name{margin:0;font-size:22px;font-weight:700;line-height:1.2}.inv-proprietor{font-size:12.5px;font-weight:600;margin-top:.1mm}.inv-proprietor-paragraph{display:block;font-size:11px;line-height:1.4;color:#6b7375;margin-top:.5mm;max-width:92mm;white-space:pre-wrap}.inv-shop-desc{font-size:11.5px;color:#6b7375;margin-top:1mm;max-width:92mm;white-space:pre-wrap}.inv-header-side{text-align:right;font-size:11.5px;color:#6b7375;flex-shrink:0}.inv-header-side .inv-address{max-width:60mm;margin-left:auto;white-space:pre-line}.inv-header-side .inv-phone{color:#16191a;font-weight:600}.inv-customer-info-row{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm}.inv-info-row{display:flex;flex-direction:column;align-items:flex-end;gap:1mm;font-size:12.5px;text-align:right;flex-shrink:0}.inv-customer{font-size:12.5px;min-width:0}.inv-customer-name{font-size:14.5px;font-weight:700}.inv-customer-meta{display:flex;flex-wrap:wrap;gap:1mm 6mm;color:#6b7375;margin-top:.5mm}.inv-table{width:100%;border-collapse:collapse;font-size:12px;margin:0}.inv-table th{text-align:left;font-size:12.5px;font-weight:700;color:#16191a;padding:1.5mm 2mm;border-top:1px solid #16191a;border-bottom:1px solid #d7dcdf}.inv-table th.num,.inv-table td.num{text-align:right}.inv-table td{padding:0 2mm;height:22px;border-bottom:1px solid #e2e5e6;vertical-align:middle}.inv-table td.idx{color:#8a9294;width:8mm}.inv-table td.name{word-break:break-word}.inv-bottom{display:flex;justify-content:space-between;gap:8mm}.inv-side{display:flex;flex-direction:column;gap:3mm;max-width:92mm}.inv-side-label{font-size:9px;font-weight:700;color:#6b7375;margin-bottom:1mm}.inv-payment-methods{display:flex;flex-wrap:wrap;gap:2mm}.inv-payment-chip{border:1px solid #d9dee1;padding:1.2mm 2.6mm;font-size:11px;color:#6b7375}.inv-terms{margin:0;padding-left:5mm;font-size:11px;color:#6b7375;line-height:1.5}.inv-totals{width:60mm;flex-shrink:0}.inv-total-row{display:flex;justify-content:space-between;padding:1.5mm 0;font-size:12.5px;border-bottom:1px solid #e2e5e6}.inv-total-row .v{font-weight:600}.inv-total-row.grand{align-items:baseline}.inv-total-row.grand .v{font-size:18px;font-weight:700}.inv-total-row.due{border-bottom:2px solid #16191a;font-weight:700}.inv-words{font-size:12px;text-align:left;padding-top:3px}.inv-footer-block{display:flex;flex-direction:column;gap:2mm;margin-top:8mm}.inv-signatures{display:flex;justify-content:space-between;gap:16mm}.inv-signature{flex:1;border-top:1px solid #16191a;padding-top:1.5mm;font-size:11.5px;text-align:center}.inv-footer-text{text-align:center;font-size:10.5px;color:#8a9294;border-top:1px solid #e2e5e6;padding-top:1.5mm}.invoice-paper.thermal .invoice-page{width:72mm;max-width:72mm;min-height:0;margin:0 auto;padding:4mm;font-size:11px;box-shadow:none;gap:2mm}.invoice-paper.thermal.size-58 .invoice-page{width:48mm;max-width:48mm}.invoice-paper.thermal .inv-header{display:block;text-align:center}.invoice-paper.thermal .inv-header-brand{display:block}.invoice-paper.thermal .inv-header-side{text-align:center;margin-top:2mm}.invoice-paper.thermal .inv-header-side .inv-address{max-width:none;margin:auto}.invoice-paper.thermal .inv-customer-info-row{flex-direction:column;align-items:flex-start;gap:1.5mm}.invoice-paper.thermal .inv-info-row{align-items:flex-start;text-align:left}.invoice-paper.thermal .inv-shop-name{font-size:16px}.invoice-paper.thermal .inv-proprietor-paragraph,.invoice-paper.thermal .inv-shop-desc{max-width:none}.invoice-paper.thermal .inv-table{font-size:9px}.invoice-paper.thermal .inv-table th,.invoice-paper.thermal .inv-table td{padding-left:1mm;padding-right:1mm}.invoice-paper.thermal .inv-table th:nth-child(4),.invoice-paper.thermal .inv-table td:nth-child(4){display:none}.invoice-paper.thermal .inv-bottom{flex-direction:column;gap:3mm}.invoice-paper.thermal .inv-totals{width:auto}.invoice-paper.thermal .inv-signatures{gap:6mm}.invoice-paper.thermal .inv-side{max-width:none}.invoice-paper.thermal .inv-footer-block{margin-top:4mm}
</style>
