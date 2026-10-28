<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { createBundle, getBundle, updateBundle } from '../api';
import type { BundleComponent, BundleForm } from '../api';
import type { Product } from '../types';
const props=defineProps<{ productId?:string; products:Product[] }>();
const emit=defineEmits<{ close:[]; saved:[] }>();
const loading=ref(!!props.productId),saving=ref(false),error=ref(''),revision=ref(0);
const search=ref(''),searchOpen=ref(false);
const form=reactive<BundleForm>({productName:'',brand:'',category:'',barcode:'',sellingPrice:0,components:[]});
const selectable=computed(()=>props.products.filter(p=>p.productType!=='Bundle'&&p.status==='Active'&&!p.trackSerial&&!p.trackExpiry&&!form.components.some(c=>c.productId===p.productId)&&[p.productName,p.brand,p.productId,p.barcode].join(' ').toLowerCase().includes(search.value.trim().toLowerCase())).slice(0,12));
const componentProducts=computed(()=>new Map(props.products.map(p=>[p.productId,p])));
const available=computed(()=>{
  if(!form.components.length)return 0;
  return Math.max(0,Math.min(...form.components.map(c=>Math.floor(Math.max(0,Number(componentProducts.value.get(c.productId)?.currentStock||0))/Math.max(1,c.quantityPerSet)))));
});
onMounted(async()=>{
  if(!props.productId)return;
  try{
    const result=await getBundle(props.productId);
    const b=result.bundle;
    revision.value=b.revision;
    Object.assign(form,{productName:b.productName,brand:b.brand,category:b.category,barcode:b.barcode,sellingPrice:b.sellingPrice,
      components:b.components.map(c=>({productId:c.productId,quantityPerSet:c.quantityPerSet}))});
  }catch(e){error.value=e instanceof Error?e.message:'Could not load this bundle';}
  finally{loading.value=false;}
});
function addComponent(p:Product){
  form.components.push({productId:p.productId,quantityPerSet:1});
  search.value='';searchOpen.value=false;
}
async function save(){
  error.value='';saving.value=true;
  try{
    const payload:BundleForm={...form,expectedRevision:revision.value,components:form.components.map(c=>({productId:c.productId,quantityPerSet:Number(c.quantityPerSet)}))};
    if(props.productId)await updateBundle(props.productId,payload);
    else await createBundle(payload);
    emit('saved');emit('close');
  }catch(e){error.value=e instanceof Error?e.message:'Could not save bundle';}
  finally{saving.value=false;}
}
</script>
<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal modal-lg" style="max-width:750px;max-height:92vh;overflow:auto">
      <div class="modal-header">
        <div><h3>{{productId?'Edit Bundle':'Add Bundle'}} <span class="bn-hint">— পণ্যের প্যাকেজ</span></h3><div class="bn-hint">One virtual product; actual stock remains in components.</div></div>
        <button class="modal-close" type="button" @click="emit('close')">✕</button>
      </div>
      <div class="modal-body" v-if="!loading">
        <p class="bn-hint">Bundle definition only. POS posting stays disabled until its FIFO and return workflows are completed and tested.</p>
        <div class="form-grid">
          <label class="full">Bundle Name * <span class="bn-hint">— প্যাকেজের নাম</span><input v-model.trim="form.productName" placeholder="e.g. Tubewell Set" /></label>
          <label>Category * <input v-model.trim="form.category" placeholder="e.g. Plumbing" /></label>
          <label>Brand <input v-model.trim="form.brand" placeholder="Optional" /></label>
          <label>Barcode <input v-model.trim="form.barcode" placeholder="Optional" /></label>
          <label>Selling Price per Set * <input v-model.number="form.sellingPrice" type="number" min="0" step="0.01" /></label>
        </div>
        <h4>Included Products <span class="bn-hint">— প্যাকেজের ভেতরের পণ্য</span></h4>
        <div v-for="(line,index) in form.components" :key="line.productId" class="return-search-row" style="align-items:center;gap:8px;margin-bottom:6px">
          <div style="flex:1"><strong>{{componentProducts.get(line.productId)?.displayName || componentProducts.get(line.productId)?.productName||line.productId}}</strong><div class="bn-hint">Stock unit: {{componentProducts.get(line.productId)?.unit || ''}}</div></div>
          <label>Qty / set <input v-model.number="line.quantityPerSet" type="number" min="1" step="1" style="width:80px" /></label>
          <button class="btn" type="button" @click="form.components.splice(index,1)">Remove</button>
        </div>
        <div class="return-search-row" style="position:relative">
          <input v-model.trim="search" type="search" placeholder="Search component by name, ID or barcode..." @focus="searchOpen=true" @keydown.esc="searchOpen=false" />
          <button type="button" class="btn" @click="searchOpen=!searchOpen">Add Component</button>
        </div>
        <div v-if="searchOpen" class="card" style="max-height:180px;overflow:auto;padding:8px">
          <button v-for="p in selectable" :key="p.productId" type="button" class="btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" @click="addComponent(p)">
            {{p.displayName||p.productName}} — {{p.unit}} ({{p.currentStock}} in stock)
          </button>
          <div v-if="!selectable.length" class="bn-hint">No eligible Standard products found.</div>
        </div>
        <p>Available sets (informational): <strong>{{available}}</strong>. No independent bundle stock is created.</p>
        <div v-if="error" class="field-error">{{error}}</div>
      </div>
      <div v-else class="modal-body">Loading bundle…</div>
      <div class="modal-footer">
        <button type="button" class="btn" @click="emit('close')">Cancel</button>
        <button type="button" class="btn btn-primary" :disabled="saving||loading||!form.components.length" @click="save">{{saving?'Saving…':'Save Bundle'}}</button>
      </div>
    </div>
  </div>
</template>
