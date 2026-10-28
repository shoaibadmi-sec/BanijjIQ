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
.module-tabs {
  display: flex;
  align-items: stretch;
  width: 100%;
  gap: 0;
  margin: 0 0 14px;
  border-bottom: 1px solid #dbe3ef;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.module-tab {
  position: relative;
  flex: 0 0 auto;
  min-width: max-content;
  padding: 9px 14px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #111827;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.module-tab:hover {
  background: #f8fafc;
}

.module-tab::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
}

.module-tab.active {
  color: #2563eb;
}

.module-tab.active::after {
  background: #2563eb;
}

.module-tab-label,
.module-tab-hint {
  display: block;
  white-space: nowrap;
}

.module-tab-label {
  font-size: 0.94rem;
  font-weight: 700;
  line-height: 1.2;
}

.module-tab-hint {
  margin-top: 1px;
  color: #64748b;
  font-size: 0.78rem;
  font-weight: 400;
  line-height: 1.15;
}

.module-tab.active .module-tab-hint {
  color: #64748b;
}

.module-tab:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: -2px;
}

@media (max-width: 640px) {
  .module-tabs {
    margin-bottom: 10px;
  }

  .module-tab {
    padding: 8px 11px 9px;
  }

  .module-tab-label {
    font-size: 0.9rem;
  }

  .module-tab-hint {
    font-size: 0.74rem;
  }
}
</style>
