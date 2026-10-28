<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getProductConversions, saveProductConversions } from '../api';
import type { ProductUnitRelation } from '../api';
const props = defineProps<{ productId: string; productName: string; baseUnit: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const relations = ref<ProductUnitRelation[]>([]);
const loading = ref(true), saving = ref(false), error = ref('');
onMounted(async () => {
  try { relations.value = (await getProductConversions(props.productId)).relations; }
  catch (e) { error.value = e instanceof Error ? e.message : 'Could not load unit conversions'; }
  finally { loading.value = false; }
});
function addUnit() {
  if (relations.value.length >= 8) return;
  relations.value.unshift({ unit:'', count:2, smallerUnit:'' });
}
async function save() {
  if(saving.value) return;
  saving.value = true; error.value = '';
  try {
    const chain = relations.value.map((r,i) => ({
      unit:r.unit.trim(), count:Number(r.count),
      smallerUnit: i+1 < relations.value.length ? relations.value[i+1].unit.trim() : props.baseUnit
    }));
    await saveProductConversions(props.productId,chain);
    emit('saved'); emit('close');
  } catch(e) { error.value = e instanceof Error ? e.message : 'Could not save unit conversions'; }
  finally { saving.value = false; }
}
</script>
<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal" style="max-width:640px">
      <div class="modal-header"><div><h3>Multi-unit Quantity <span class="bn-hint">— একাধিক একক</span></h3><span class="bn-hint">{{ productName }}</span></div><button class="modal-close" @click="emit('close')">✕</button></div>
      <div class="modal-body">
        <p class="bn-hint">Enter units as you use them in the shop. Stock stays in the smallest unit: <strong>{{ baseUnit }}</strong>.</p>
        <div v-if="loading">Loading units...</div>
        <div v-for="(line,i) in relations" :key="i" class="form-grid" style="grid-template-columns:24px 1fr 65px 1fr auto;align-items:center;margin-bottom:8px;gap:8px">
          <span>1</span><input v-model.trim="line.unit" aria-label="Larger unit" placeholder="e.g. Carton" />
          <input v-model.number="line.count" aria-label="Conversion quantity" type="number" min="2" step="1" />
          <span>{{ i+1 < relations.length ? (relations[i+1].unit || 'next unit') : baseUnit }}</span>
          <button type="button" class="btn btn-sm" @click="relations.splice(i,1)">Remove</button>
        </div>
        <button class="btn" type="button" :disabled="relations.length>=8" @click="addUnit">+ Add larger unit</button>
        <p class="bn-hint">Example: 1 Carton = 12 Box, 1 Box = 20 Pcs. Existing invoices and base stock quantities are not rewritten.</p>
        <div class="field-error" v-if="error">{{error}}</div>
      </div>
      <div class="modal-footer"><button class="btn" @click="emit('close')">Cancel</button><button class="btn btn-primary" :disabled="saving||loading" @click="save">{{ saving?'Saving…':'Save Units' }}</button></div>
    </div>
  </div>
</template>
