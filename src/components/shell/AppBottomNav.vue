<script setup lang="ts">
import { computed } from 'vue';
import type { ShellNavItem } from './types';
const props = defineProps<{ items: ShellNavItem[]; activeKey: string }>();
const emit = defineEmits<{ select: [key: string]; more: [] }>();
const featuredKeys = ['dashboard','pos','sales','customers'];
const featured = computed(() => featuredKeys.map(key => props.items.find(item => item.key === key)).filter((item): item is ShellNavItem => Boolean(item)));
</script>
<template>
  <nav class="bottom-nav" aria-label="Primary modules">
    <button v-for="item in featured" :key="item.key" type="button" class="bottom-item" :class="{ 'is-current': activeKey === item.key }" :aria-current="activeKey === item.key ? 'page' : undefined" :aria-label="item.label" @click="emit('select', item.key)">
      <span class="bottom-item-icon" aria-hidden="true">{{ item.icon }}</span><span class="bottom-item-label">{{ item.label }}</span>
    </button>
    <button type="button" class="bottom-item bottom-more" aria-label="Open all modules" @click="emit('more')"><span class="bottom-item-icon" aria-hidden="true">☰</span><span class="bottom-item-label">More</span></button>
  </nav>
</template>
<style scoped>
.bottom-nav{display:none}
@media(max-width:640px){
.bottom-nav{position:fixed;inset:auto 0 0;z-index:95;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));min-height:68px;padding:4px max(4px,env(safe-area-inset-right)) calc(4px + env(safe-area-inset-bottom)) max(4px,env(safe-area-inset-left));border-top:1px solid var(--sher-line);background:var(--sher-raised)}
.bottom-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:0;min-height:60px;border:0;border-radius:var(--sher-radius);background:transparent;color:var(--sher-text-muted);font:600 var(--sher-text-2xs)/1.2 var(--sher-font);cursor:pointer}
.bottom-item-icon{font-size:18px;line-height:1.2}
.bottom-item-label{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bottom-item.is-current{background:var(--sher-nav-active-bg);color:var(--sher-nav-active-fg)}
.bottom-item:focus-visible{outline:2px solid var(--sher-primary);outline-offset:-2px}
}
</style>