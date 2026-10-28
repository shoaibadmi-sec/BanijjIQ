<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  createProductSearchIndex,
  getProductSearchLabel,
  searchProductIndex,
  type ProductSearchSource
} from '../../utils/productSearch';

const props = withDefaults(defineProps<{
  modelValue: string;
  items: ProductSearchSource[];
  placeholder?: string;
  disabled?: boolean;
  maxResults?: number;
  showStock?: boolean;
  ariaLabel?: string;
}>(), {
  placeholder: 'Search product...',
  disabled: false,
  maxResults: 12,
  showStock: true,
  ariaLabel: 'Search product'
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  select: [product: ProductSearchSource | null];
}>();

const query = ref('');
const open = ref(false);
const highlighted = ref(0);
const root = ref<HTMLElement | null>(null);
const indexes = computed(() => createProductSearchIndex(props.items));
const selected = computed(() => props.items.find((item) => String(item.productId ?? item.id ?? '') === props.modelValue) ?? null);
const results = computed(() => searchProductIndex(indexes.value, query.value, { limit: props.maxResults }).map((result) => result.product));

function syncSelectedLabel(): void {
  if (selected.value) query.value = getProductSearchLabel(selected.value);
  else if (!open.value) query.value = '';
}
watch(() => props.modelValue, syncSelectedLabel, { immediate: true });
watch(() => props.items, syncSelectedLabel);
watch(results, (rows) => {
  if (!rows.length) highlighted.value = -1;
  else highlighted.value = Math.min(Math.max(highlighted.value, 0), rows.length - 1);
});

function productId(product: ProductSearchSource): string {
  return String(product.productId ?? product.id ?? '');
}
function productMeta(product: ProductSearchSource): string {
  const parts = [product.brand, product.category, product.unit].map((x) => String(x ?? '').trim()).filter(Boolean);
  return parts.join(' · ');
}
function stockValue(product: ProductSearchSource): number {
  return Number(product.currentStock ?? product.stock ?? 0) || 0;
}
function beginInput(): void {
  open.value = true;
  highlighted.value = results.value.length ? 0 : -1;
  if (props.modelValue) emit('update:modelValue', '');
}
function clear(): void {
  query.value = '';
  highlighted.value = results.value.length ? 0 : -1;
  emit('update:modelValue', '');
  emit('select', null);
  open.value = true;
}
function choose(product: ProductSearchSource): void {
  query.value = getProductSearchLabel(product);
  emit('update:modelValue', productId(product));
  emit('select', product);
  open.value = false;
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault(); open.value = true;
    if (results.value.length) highlighted.value = (highlighted.value + 1 + results.value.length) % results.value.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault(); open.value = true;
    if (results.value.length) highlighted.value = (highlighted.value - 1 + results.value.length) % results.value.length;
  } else if (event.key === 'Enter') {
    if (!open.value) { open.value = true; return; }
    const product = results.value[highlighted.value];
    if (product) { event.preventDefault(); choose(product); }
  } else if (event.key === 'Escape') {
    open.value = false;
    syncSelectedLabel();
  }
}
function onDocumentPointer(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
    syncSelectedLabel();
  }
}
if (typeof document !== 'undefined') document.addEventListener('pointerdown', onDocumentPointer);
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer));
</script>

<template>
  <div ref="root" class="product-search-select" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <div class="product-search-select-input-wrap">
      <input
        v-model="query"
        type="search"
        autocomplete="off"
        class="product-search-select-input"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :aria-expanded="open"
        @focus="open = true; highlighted = results.length ? 0 : -1"
        @input="beginInput"
        @keydown="onKeydown"
      />
      <button v-if="query && !disabled" type="button" class="product-search-select-clear" aria-label="Clear product search" @click="clear">×</button>
    </div>
    <div v-if="open && !disabled" class="product-search-select-menu" role="listbox">
      <button
        v-for="(product, index) in results"
        :key="productId(product)"
        type="button"
        class="product-search-select-option"
        :class="{ 'is-highlighted': index === highlighted, 'is-selected': productId(product) === modelValue }"
        role="option"
        :aria-selected="productId(product) === modelValue"
        @mouseenter="highlighted = index"
        @click="choose(product)"
      >
        <span class="product-search-select-copy">
          <strong>{{ getProductSearchLabel(product) }}</strong>
          <small v-if="productMeta(product)">{{ productMeta(product) }}</small>
        </span>
        <span v-if="showStock" class="product-search-select-stock" :class="{ 'is-out': stockValue(product) <= 0 }">{{ stockValue(product).toLocaleString() }}</span>
      </button>
      <div v-if="!results.length" class="product-search-select-empty">No matching products.</div>
    </div>
  </div>
</template>

<style scoped>
.product-search-select{position:relative;width:100%;min-width:0}.product-search-select-input-wrap{position:relative}.product-search-select-input{width:100%;min-height:42px;padding-right:38px}.product-search-select-input::-webkit-search-cancel-button{display:none}.product-search-select-clear{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--color-text-muted,#64748b);font-size:20px;line-height:1;cursor:pointer}.product-search-select-clear:hover{background:var(--color-surface-muted,#f1f5f9);color:var(--color-text,#0f172a)}.product-search-select-menu{position:absolute;z-index:1200;top:calc(100% + 5px);left:0;right:0;max-height:320px;overflow:auto;padding:5px;border:1px solid var(--color-border,#dbe3ef);border-radius:10px;background:var(--color-surface,#fff);box-shadow:0 14px 32px rgba(15,23,42,.16)}.product-search-select-option{width:100%;min-height:46px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:var(--color-text,#0f172a);font:inherit;text-align:left;cursor:pointer}.product-search-select-option:hover,.product-search-select-option.is-highlighted{background:var(--color-primary-soft,#eff6ff)}.product-search-select-option.is-selected{box-shadow:inset 3px 0 0 var(--color-primary,#2563eb)}.product-search-select-copy{min-width:0;display:grid;gap:2px}.product-search-select-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.product-search-select-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text-muted,#64748b);font-size:11px}.product-search-select-stock{flex:0 0 auto;font-size:11px;font-weight:700;color:var(--color-success,#15803d)}.product-search-select-stock.is-out{color:var(--color-danger,#dc2626)}.product-search-select-empty{padding:12px 10px;color:var(--color-text-muted,#64748b);font-size:12px}.is-disabled{opacity:.65}@media(max-width:620px){.product-search-select-input{min-height:44px;font-size:16px}.product-search-select-option{min-height:50px;padding:9px 10px}.product-search-select-menu{max-height:44vh}}
</style>
