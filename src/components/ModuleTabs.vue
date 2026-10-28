<script setup lang="ts">
type ModuleTab = {
  key: string;
  label: string;
  hint?: string;
};

const props = withDefaults(
  defineProps<{
    modelValue: string;
    tabs: readonly ModuleTab[];
    ariaLabel?: string;
  }>(),
  {
    ariaLabel: 'Module sections'
  }
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

function selectTab(key: string): void {
  if (key !== props.modelValue) {
    emit('update:modelValue', key);
  }
}
</script>

<template>
  <nav class="module-tabs" :aria-label="ariaLabel">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="module-tab"
      :class="{ active: modelValue === tab.key }"
      :aria-current="modelValue === tab.key ? 'page' : undefined"
      @click="selectTab(tab.key)"
    >
      <span class="module-tab-label">{{ tab.label }}</span>
      <span v-if="tab.hint" class="module-tab-hint">{{ tab.hint }}</span>
    </button>
  </nav>
</template>

<style scoped>
.module-tabs { display: flex; align-items: stretch; gap: 20px; width: 100%; margin: 0 0 14px; border-bottom: 1px solid var(--sher-line); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.module-tabs::-webkit-scrollbar { display: none; }
.module-tab { position: relative; flex: 0 0 auto; min-width: max-content; padding: 7px 0 10px; border: 0; border-radius: 0; background: transparent; color: var(--sher-text-muted); font: inherit; text-align: left; cursor: pointer; }
.module-tab:hover { color: var(--sher-text); }
.module-tab::after { content: ''; position: absolute; inset: auto 0 -1px; height: 2px; background: transparent; }
.module-tab.active { color: var(--sher-primary-text); }
.module-tab.active::after { background: var(--sher-primary); }
.module-tab-label,.module-tab-hint { display: block; white-space: nowrap; }
.module-tab-label { font-size: var(--sher-text-sm); font-weight: 600; line-height: 1.3; }
.module-tab-hint { margin-top: 1px; color: var(--sher-text-faint); font-family: var(--sher-font-bn); font-size: var(--sher-text-2xs); font-weight: 400; line-height: 1.3; }
.module-tab:focus-visible { outline: 2px solid var(--sher-primary); outline-offset: -2px; }
@media (max-width: 640px) { .module-tabs { gap: 14px; margin-bottom: 12px; } .module-tab { padding: 7px 0 9px; } }
</style>