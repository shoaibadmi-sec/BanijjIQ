<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ShellNavItem } from './types';
const props = defineProps<{ items: ShellNavItem[] }>();
const emit = defineEmits<{ select: [key: string] }>();
const open = ref(false);
const query = ref('');
const selectedIndex = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const matches = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return props.items.filter(item => !needle || [item.label, item.hint, item.key].some(value => value.toLocaleLowerCase().includes(needle))).slice(0, 12);
});
function openSearch() { query.value = ''; selectedIndex.value = 0; open.value = true; void nextTick(() => searchInput.value?.focus()); }
function closeSearch() { open.value = false; void nextTick(() => trigger.value?.focus()); }
function choose(key: string) { emit('select', key); closeSearch(); }
function onHotkey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
  event.preventDefault();
  if (!open.value) openSearch(); else closeSearch();
}
function onKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
  const count = Math.max(1, matches.value.length);
  if (event.key === 'ArrowDown') { event.preventDefault(); selectedIndex.value = (selectedIndex.value + 1) % count; }
  if (event.key === 'ArrowUp') { event.preventDefault(); selectedIndex.value = (selectedIndex.value - 1 + count) % count; }
  if (event.key === 'Enter' && matches.value[selectedIndex.value]) { event.preventDefault(); choose(matches.value[selectedIndex.value]!.key); }
}
onMounted(() => window.addEventListener('keydown', onHotkey));
onBeforeUnmount(() => window.removeEventListener('keydown', onHotkey));
</script>
<template>
  <button ref="trigger" type="button" class="module-search-trigger" aria-label="Find a module" title="Find a module (Ctrl K)" @click="openSearch">
    <span aria-hidden="true">⌕</span><span class="module-search-label">Find a module</span><kbd>Ctrl K</kbd>
  </button>
  <Teleport to="body">
    <div v-if="open" class="module-search-scrim" @click.self="closeSearch" @keydown="onKeys">
      <section class="module-search-dialog" role="dialog" aria-modal="true" aria-label="Find a module">
        <div class="module-search-field">
          <span aria-hidden="true">⌕</span>
          <input ref="searchInput" v-model="query" type="search" aria-label="Filter modules" placeholder="Find Dashboard, POS, Finance..." @input="selectedIndex = 0" />
          <button type="button" aria-label="Close" @click="closeSearch">Esc</button>
        </div>
        <div class="module-search-options">
          <p v-if="matches.length === 0" class="module-search-empty">No matching module.</p>
          <button v-for="(item, index) in matches" :key="item.key" type="button" class="module-search-option"
            :class="{ 'is-selected': selectedIndex === index }" @mouseenter="selectedIndex = index" @click="choose(item.key)">
            <span aria-hidden="true">{{ item.icon }}</span><span><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></span>
          </button>
        </div>
        <p class="module-search-help">Type to filter · ↑↓ to move · Enter to open · Esc to close</p>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.module-search-trigger{display:inline-flex;align-items:center;gap:10px;flex:0 1 360px;width:100%;min-width:120px;height:36px;padding:0 10px;border:1px solid var(--sher-line);border-radius:var(--sher-radius);background:var(--sher-raised);color:var(--sher-text-muted);font:400 13px var(--sher-font);cursor:pointer}
.module-search-trigger>span:first-child{font-size:23px;line-height:1}
.module-search-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.module-search-trigger kbd{margin-left:auto;padding:2px 5px;border:1px solid var(--sher-line);border-radius:4px;color:var(--sher-text-faint);font-size:10px;white-space:nowrap}
.module-search-trigger:hover{border-color:var(--sher-line-strong);background:var(--sher-hover)}
.module-search-scrim{position:fixed;inset:0;z-index:2000;display:flex;justify-content:center;align-items:flex-start;padding:min(16vh,140px) 12px 12px;background:var(--sher-scrim)}
.module-search-dialog{width:min(520px,100%);border:1px solid var(--sher-line);border-radius:var(--sher-radius-lg);background:var(--sher-raised);box-shadow:var(--sher-shadow-raised);overflow:hidden}
.module-search-field{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--sher-line)}
.module-search-field>span{font-size:25px;color:var(--sher-text-faint)}
.module-search-field input{flex:1;min-width:0;height:38px;border:0!important;padding:0 4px;box-shadow:none!important;outline:none;background:transparent}
.module-search-field button{border:1px solid var(--sher-line);background:transparent;border-radius:5px;color:var(--sher-text-faint);padding:4px 6px;cursor:pointer;font-size:11px}
.module-search-options{max-height:min(52vh,400px);overflow:auto;padding:7px}
.module-search-option{display:flex;align-items:center;gap:12px;width:100%;padding:9px 12px;border:0;border-radius:var(--sher-radius);background:transparent;color:var(--sher-text);text-align:left;cursor:pointer}
.module-search-option>span:first-child{min-width:22px;font-size:18px;text-align:center}
.module-search-option>span:last-child{display:flex;flex-direction:column}
.module-search-option strong{font-size:13px;font-weight:600}
.module-search-option small{font-size:11px;font-weight:400;color:var(--sher-text-faint)}
.module-search-option:hover,.module-search-option.is-selected{background:var(--sher-primary-softer)}
.module-search-empty{padding:18px;color:var(--sher-text-muted);font-size:13px}
.module-search-help{margin:0;padding:10px 14px;border-top:1px solid var(--sher-line);color:var(--sher-text-faint);font-size:11px}
@media(max-width:1024px){.module-search-trigger{flex:0 0 40px;width:40px;min-width:40px;justify-content:center;padding:0}.module-search-label,.module-search-trigger kbd{display:none}}
</style>