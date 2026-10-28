<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  completeBatchSalesReturn, getBatchReturnCustomerInvoices, getSaleReturnData, searchBatchReturnCustomers
} from '../api';
import type { BatchReturnCustomer, BatchReturnInvoice } from '../api';
import type { SaleReturnData } from '../types';
const emit=defineEmits<{ close:[]; completed:[message:string] }>();
const today=new Date().toISOString().slice(0,10);
const search=ref(''), customers=ref<BatchReturnCustomer[]>([]);
const customer=ref<BatchReturnCustomer|null>(null), invoices=ref<BatchReturnInvoice[]>([]);
const selected=ref<string[]>([]);
type PreparedLine={productId:string;name:string;availableQty:number;returnQty:number;unitPrice:number;maxPrice:number;tracked:boolean};
type PreparedInvoice={invoiceId:string;date:string;lines:PreparedLine[];paidAmount:number;grandTotal:number;previouslyReturnedAmount:number};
const prepared=ref<PreparedInvoice[]>([]);
const refundMethod=ref<'Cash'|'Store Credit'>('Cash'), date=ref(today),reason=ref(''),notes=ref(''),backdatedReason=ref('');
const loading=ref(false),saving=ref(false),error=ref('');
const total=computed(()=>prepared.value.reduce((a,inv)=>a+inv.lines.reduce((n,l)=>n+l.returnQty*l.unitPrice,0),0));
async function findCustomers(){
  if(search.value.trim().length<2){error.value='Type at least two characters';return;}
  loading.value=true;error.value='';
  try{customers.value=(await searchBatchReturnCustomers(search.value.trim())).customers;}
  catch(e){error.value=e instanceof Error?e.message:'Could not find customers';}
  finally{loading.value=false;}
}
async function chooseCustomer(c:BatchReturnCustomer){
  customer.value=c;selected.value=[];prepared.value=[];loading.value=true;error.value='';
  try { invoices.value=(await getBatchReturnCustomerInvoices(c.id)).invoices; }
  catch(e){error.value=e instanceof Error?e.message:'Could not load invoices';}
  finally{loading.value=false;}
}
function toggleInvoice(id:string,checked:boolean){
  if(checked&&!selected.value.includes(id)&&selected.value.length<20)selected.value.push(id);
  else if(!checked)selected.value=selected.value.filter(x=>x!==id);
  prepared.value=[];
}
async function prepare(){
  if(selected.value.length<2){error.value='Select at least two invoices from the same customer';return;}
  loading.value=true;error.value='';
  try{
    const data=await Promise.all(selected.value.map(id=>getSaleReturnData(id)));
    prepared.value=data.map(({sale}: {sale:SaleReturnData})=>{
      const rate=Number(sale.subtotal||0)>0?Math.min(1,sale.grandTotal/Number(sale.subtotal)):1;
      return {invoiceId:sale.invoiceId,date:sale.date,grandTotal:sale.grandTotal,paidAmount:sale.paidAmount,previouslyReturnedAmount:sale.previouslyReturnedAmount,
        lines:sale.items.filter(item=>item.availableQty>0).map(item=>({
          productId:item.productId,name:item.name,availableQty:item.availableQty,returnQty:0,
          unitPrice:Math.round(item.unitPrice*rate*100)/100,maxPrice:Math.round(item.unitPrice*rate*100)/100,
          tracked:!!(item.trackSerial||item.trackExpiry)
        }))};
    });
    if(prepared.value.some(i=>!i.lines.length))error.value='Some invoices have no remaining eligible products.';
  }catch(e){error.value=e instanceof Error?e.message:'Could not load return details';}
  finally{loading.value=false;}
}
async function complete(){
  if(!customer.value||!prepared.value.length)return;
  if(!reason.value.trim()){error.value='Return reason is required';return;}
  if(date.value<today&&!backdatedReason.value.trim()){error.value='Enter a backdating reason';return;}
  const payload=prepared.value.map(inv=>({invoiceId:inv.invoiceId,items:inv.lines.filter(l=>l.returnQty>0).map(l=>({productId:l.productId,qty:l.returnQty,unitPrice:l.unitPrice}))}));
  if(payload.some(inv=>!inv.items.length)){error.value='Select at least one return line from each invoice';return;}
  if(prepared.value.some(inv=>inv.lines.some(l=>l.tracked&&l.returnQty>0))){error.value='Serial/Expiry tracked items currently require the normal single-invoice return.';return;}
  saving.value=true;error.value='';
  try{
    const r=await completeBatchSalesReturn({customerId:customer.value.id,refundMethod:refundMethod.value,reason:reason.value.trim(),date:date.value,notes:notes.value,backdatedReason:backdatedReason.value,invoices:payload});
    emit('completed',`Batch ${r.batchId}: ${r.returns.length} returns, ৳${r.totalReturnAmount.toFixed(2)}`);
  }catch(e){error.value=e instanceof Error?e.message:'Batch return failed';}
  finally{saving.value=false;}
}
</script>
<template>
 <div class="modal-overlay" @click.self="emit('close')">
  <div class="modal modal-lg" style="max-width:950px;max-height:90vh;overflow:auto">
   <div class="modal-header"><div><h3>Customer Batch Return <span class="bn-hint">— একসাথে একাধিক রশিদ ফেরত</span></h3><span class="bn-hint">Each invoice retains its own return record and refund limit</span></div><button class="modal-close" @click="emit('close')">✕</button></div>
   <div class="modal-body">
    <div class="return-search-row"><input v-model.trim="search" type="search" placeholder="Customer ID, name or phone" @keyup.enter="findCustomers" /><button class="btn btn-primary" :disabled="loading" @click="findCustomers">Find Customer</button></div>
    <div v-if="!customer && customers.length" class="table-scroll"><table><thead><tr><th>Customer</th><th>Phone</th><th>Invoices</th><th></th></tr></thead><tbody><tr v-for="c in customers" :key="c.id"><td>{{c.name}}</td><td>{{c.phone}}</td><td>{{c.invoiceCount}}</td><td><button class="btn btn-sm" @click="chooseCustomer(c)">View Invoices</button></td></tr></tbody></table></div>
    <template v-if="customer">
      <h4>{{customer.name}} — {{customer.phone}}</h4>
      <button class="btn btn-sm" @click="customer=null;prepared=[];selected=[]">Change Customer</button>
      <div v-if="!prepared.length" class="table-scroll"><table><thead><tr><th></th><th>Invoice</th><th>Date</th><th>Total</th><th>Paid</th><th>Due</th><th>Returned</th></tr></thead><tbody>
        <tr v-for="inv in invoices" :key="inv.invoiceId"><td><input type="checkbox" :checked="selected.includes(inv.invoiceId)" :disabled="inv.remainingQuantity<=0" @change="toggleInvoice(inv.invoiceId,($event.target as HTMLInputElement).checked)" /></td><td>{{inv.invoiceId}}</td><td>{{inv.date}}</td><td>{{inv.grandTotal.toFixed(2)}}</td><td>{{inv.paidAmount.toFixed(2)}}</td><td>{{inv.dueAmount.toFixed(2)}}</td><td>{{inv.returnedAmount.toFixed(2)}}</td></tr>
      </tbody></table></div>
      <button v-if="!prepared.length" class="btn btn-primary" :disabled="selected.length<2||loading" @click="prepare">Continue with {{selected.length}} Invoices</button>
      <template v-for="inv in prepared" :key="inv.invoiceId">
       <h4>{{inv.invoiceId}} · {{inv.date}}</h4>
       <div class="table-scroll"><table><thead><tr><th>Product</th><th>Available</th><th>Return Qty</th><th>Return Price</th><th>Line Total</th></tr></thead><tbody>
        <tr v-for="line in inv.lines" :key="line.productId">
         <td>{{line.name}} <span v-if="line.tracked" class="bn-hint">Tracked: single return only</span></td><td>{{line.availableQty}}</td>
         <td><input v-model.number="line.returnQty" type="number" min="0" :max="line.availableQty" step="1" :disabled="line.tracked" style="width:80px" /></td>
         <td><input v-model.number="line.unitPrice" type="number" min="0" :max="line.maxPrice" step="0.01" :disabled="line.tracked" style="width:100px" /></td>
         <td>{{(line.returnQty*line.unitPrice).toFixed(2)}}</td>
        </tr></tbody></table></div>
      </template>
      <div v-if="prepared.length" class="form-grid">
        <label>Refund Method <select v-model="refundMethod"><option value="Cash">Cash</option><option value="Store Credit">Store Credit</option></select></label>
        <label>Return Date <input v-model="date" type="date" :max="today" /></label>
        <label class="full">Reason * <input v-model.trim="reason" placeholder="Return reason" /></label>
        <label class="full">Notes <input v-model.trim="notes" placeholder="Optional" /></label>
        <label v-if="date<today" class="full">Backdated reason * <input v-model.trim="backdatedReason" /></label>
      </div>
      <p v-if="prepared.length">Total Return: <strong>৳{{total.toFixed(2)}}</strong></p>
      <div v-if="error" class="field-error">{{error}}</div>
    </template>
    <div v-else-if="error" class="field-error">{{error}}</div>
   </div>
   <div class="modal-footer"><button class="btn" @click="emit('close')">Cancel</button><button v-if="prepared.length" class="btn btn-primary" :disabled="saving||loading" @click="complete">{{saving?'Saving…':'Complete Batch Return'}}</button></div>
  </div>
 </div>
</template>
