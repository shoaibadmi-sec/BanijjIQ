<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import ExpiryPicker from './ExpiryPicker.vue';
import type { ExpiryBatchInput, LotTrackingInput } from '../../types';

const props = defineProps<{
  modelValue?: LotTrackingInput;
  productName: string;
  quantity: number;
  trackSerial: boolean;
  trackExpiry: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue':[value:LotTrackingInput] }>();

type BatchDraft = { quantity:number; expiryDate:string; batchNo:string; serialText:string };
const state = reactive<{ serialText:string; batches:BatchDraft[] }>({ serialText:'', batches:[] });
let syncing=false;
let lastEmittedKey='';
function lines(text:string){ return Array.from(new Set(String(text||'').split(/[\n,;\t]+/).map(s=>s.trim()).filter(Boolean))); }
function trackingValueFromState():LotTrackingInput{
  const value:LotTrackingInput={};
  if(props.trackExpiry){
    value.expiryBatches=state.batches.map(b=>({
      quantity:props.trackSerial?lines(b.serialText).length:Math.max(0,Math.round(Number(b.quantity||0))),
      expiryDate:String(b.expiryDate||''),
      batchNo:String(b.batchNo||'').trim(),
      ...(props.trackSerial?{serialNumbers:lines(b.serialText)}:{})
    } as ExpiryBatchInput));
  }else if(props.trackSerial){
    value.serialNumbers=lines(state.serialText);
  }
  return value;
}
function trackingKey(value?:LotTrackingInput){
  const normalized:LotTrackingInput={};
  if(props.trackExpiry){
    normalized.expiryBatches=(value?.expiryBatches||[]).map(b=>({
      quantity:props.trackSerial?(b.serialNumbers||[]).length:Math.max(0,Math.round(Number(b.quantity||0))),
      expiryDate:String(b.expiryDate||''),
      batchNo:String(b.batchNo||'').trim(),
      ...(props.trackSerial?{serialNumbers:Array.from(new Set((b.serialNumbers||[]).map(s=>String(s).trim()).filter(Boolean)))}:{})
    } as ExpiryBatchInput));
  }else if(props.trackSerial){
    normalized.serialNumbers=Array.from(new Set((value?.serialNumbers||[]).map(s=>String(s).trim()).filter(Boolean)));
  }
  return JSON.stringify(normalized);
}
function load(value?:LotTrackingInput){
  const incomingKey=trackingKey(value);
  if(incomingKey===trackingKey(trackingValueFromState())){
    lastEmittedKey=incomingKey;
    return;
  }
  syncing=true;
  state.serialText=(value?.serialNumbers||[]).join('\n');
  state.batches=(value?.expiryBatches||[]).map(b=>({quantity:Number(b.quantity||0),expiryDate:String(b.expiryDate||''),batchNo:String(b.batchNo||''),serialText:(b.serialNumbers||[]).join('\n')}));
  if(props.trackExpiry && !state.batches.length) state.batches=[{quantity:0,expiryDate:'',batchNo:'',serialText:''}];
  lastEmittedKey=incomingKey;
  syncing=false;
}
watch(()=>props.modelValue,load,{deep:true,immediate:true});
watch(()=>[props.trackSerial,props.trackExpiry],()=>load(props.modelValue));
watch(state,()=>{
  if(syncing)return;
  const value=trackingValueFromState();
  const key=trackingKey(value);
  if(key===lastEmittedKey || key===trackingKey(props.modelValue))return;
  lastEmittedKey=key;
  emit('update:modelValue',value);
},{deep:true,flush:'sync'});

const assigned=computed(()=>props.trackExpiry
  ?state.batches.reduce((n,b)=>n+(props.trackSerial?lines(b.serialText).length:Math.max(0,Math.round(Number(b.quantity||0)))),0)
  :(props.trackSerial?lines(state.serialText).length:Math.round(Number(props.quantity||0))));
const ready=computed(()=>assigned.value===Math.max(0,Math.round(Number(props.quantity||0))));
function addBatch(){state.batches.push({quantity:0,expiryDate:'',batchNo:'',serialText:''});}
function removeBatch(i:number){state.batches.splice(i,1);if(!state.batches.length)addBatch();}
function clearSerials(){state.serialText='';}
function clearBatchSerials(i:number){if(state.batches[i])state.batches[i].serialText='';}
</script>

<template>
  <div class="tracking-entry">
    <div class="tracking-entry-head">
      <div><strong>{{ productName }}</strong><span>{{ Math.round(Number(quantity||0)) }} item(s) require tracking</span></div>
      <span class="tracking-progress" :class="ready?'is-ready':'is-pending'">{{ assigned }} / {{ Math.round(Number(quantity||0)) }} {{ ready?'Ready':'Pending' }}</span>
    </div>

    <div v-if="trackSerial && !trackExpiry" class="tracking-block">
      <div class="tracking-row-title"><label>Serial / IMEI <span>Paste from scanner/Excel using line, comma, tab, or semicolon separators.</span></label><button v-if="state.serialText" type="button" class="btn btn-sm" @click="clearSerials">Clear</button></div>
      <textarea v-model="state.serialText" rows="7" placeholder="Scan or paste Serial / IMEI values"></textarea>
    </div>

    <div v-if="trackExpiry" class="tracking-block">
      <div class="tracking-row-title"><label>Expiry batches <span>Items sharing the same expiry month can be one batch.</span></label><button type="button" class="btn btn-sm" @click="addBatch">+ Add Batch</button></div>
      <div v-for="(batch,index) in state.batches" :key="index" class="tracking-batch">
        <div class="tracking-batch-grid">
          <div v-if="!trackSerial"><label>Qty</label><input v-model.number="batch.quantity" type="number" min="0" step="1" data-integer="true" /></div>
          <div><label>Expiry Month</label><ExpiryPicker v-model="batch.expiryDate" placeholder="Select expiry month" /></div>
          <div><label>Batch No. <small>(optional)</small></label><input v-model.trim="batch.batchNo" type="text" placeholder="Batch / lot no." /></div>
          <button v-if="state.batches.length>1" type="button" class="btn btn-sm btn-danger tracking-remove-batch" @click="removeBatch(index)">Remove</button>
        </div>
        <div v-if="trackSerial" class="tracking-serials-in-batch">
          <div class="tracking-row-title"><label>Serial / IMEI for this expiry batch <span>{{ lines(batch.serialText).length }} entered</span></label><button v-if="batch.serialText" type="button" class="btn btn-sm" @click="clearBatchSerials(index)">Clear</button></div>
          <textarea v-model="batch.serialText" rows="5" placeholder="Paste Serial / IMEI values: line, comma, tab, or semicolon separated"></textarea>
        </div>
      </div>
    </div>

    <div class="tracking-note" :class="ready?'is-ready':'is-pending'">
      <template v-if="ready">✓ Tracking is complete. This stock will be ready to sell.</template>
      <template v-else>⚠ Missing tracking is allowed. Unassigned stock will stay <strong>Pending Tracking</strong> and cannot be sold until completed.</template>
    </div>
  </div>
</template>

<style scoped>
.tracking-entry{display:grid;gap:14px}.tracking-entry-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface-muted,#f8fafc)}.tracking-entry-head div{display:grid;gap:3px}.tracking-entry-head span,label span{font-size:12px;color:var(--color-text-muted)}.tracking-progress{padding:5px 9px;border-radius:999px;font-weight:700;white-space:nowrap}.tracking-progress.is-ready{background:#dcfce7;color:#166534}.tracking-progress.is-pending{background:#fef3c7;color:#92400e}.tracking-block{display:grid;gap:8px}.tracking-block label{display:grid;gap:2px}.tracking-block textarea{width:100%;resize:vertical;min-height:110px}.tracking-row-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.tracking-batch{padding:12px;border:1px solid var(--color-border);border-radius:10px;display:grid;gap:10px}.tracking-batch-grid{display:grid;grid-template-columns:minmax(90px,.6fr) minmax(170px,1fr) minmax(150px,1fr) auto;gap:10px;align-items:end}.tracking-batch-grid>div{display:grid;gap:5px}.tracking-remove-batch{margin-bottom:1px}.tracking-serials-in-batch{display:grid;gap:6px}.tracking-serials-in-batch label{display:flex;justify-content:space-between;gap:8px}.tracking-note{font-size:13px;padding:10px 12px;border-radius:9px}.tracking-note.is-ready{background:#f0fdf4;color:#166534}.tracking-note.is-pending{background:#fffbeb;color:#92400e}@media(max-width:700px){.tracking-entry-head,.tracking-row-title{align-items:stretch;flex-direction:column}.tracking-batch-grid{grid-template-columns:1fr}.tracking-remove-batch{width:100%}}
</style>
