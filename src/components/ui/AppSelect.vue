<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

type SelectOption = { label: string; value: string; disabled?: boolean };

const props = withDefaults(defineProps<{
  modelValue: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}>(), {
  placeholder: 'Select...',
  disabled: false,
  ariaLabel: 'Select option'
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
}>();

const open = ref(false);
const trigger = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const activeIndex = ref(-1);

const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const displayLabel = computed(() => selected.value?.label || props.placeholder);

function positionPanel() {
  if (!trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const viewportPadding = 8;
  const estimatedHeight = Math.min(280, Math.max(44, props.options.length * 42 + 12));
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const placeAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
  panelStyle.value = {
    position: 'fixed',
    left: `${Math.max(viewportPadding, rect.left)}px`,
    width: `${Math.min(rect.width, window.innerWidth - viewportPadding * 2)}px`,
    top: placeAbove ? 'auto' : `${rect.bottom + 6}px`,
    bottom: placeAbove ? `${window.innerHeight - rect.top + 6}px` : 'auto',
    zIndex: '10080'
  };
}

async function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    activeIndex.value = Math.max(0, props.options.findIndex((option) => option.value === props.modelValue && !option.disabled));
    await nextTick();
    positionPanel();
  }
}

function close() {
  open.value = false;
}

function choose(option: SelectOption) {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  emit('change', option.value);
  close();
  nextTick(() => trigger.value?.focus());
}

function moveActive(direction: 1 | -1) {
  if (!props.options.length) return;
  let index = activeIndex.value;
  for (let i = 0; i < props.options.length; i += 1) {
    index = (index + direction + props.options.length) % props.options.length;
    if (!props.options[index]?.disabled) {
      activeIndex.value = index;
      break;
    }
  }
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!open.value) void toggle();
    else moveActive(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) void toggle();
    else moveActive(-1);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!open.value) void toggle();
    else if (activeIndex.value >= 0) choose(props.options[activeIndex.value]);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target as Node;
  if (trigger.value?.contains(target)) return;
  const panel = document.querySelector('.app-select-panel[data-open="true"]');
  if (panel?.contains(target)) return;
  close();
}

watch(() => props.modelValue, () => {
  activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  window.removeEventListener('resize', positionPanel);
  window.removeEventListener('scroll', positionPanel, true);
});
</script>

<template>
  <div class="app-select">
    <button
      ref="trigger"
      type="button"
      class="app-select-trigger"
      :class="{ 'is-open': open, 'is-placeholder': !selected }"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="app-select-label">{{ displayLabel }}</span>
      <svg class="app-select-chevron" viewBox="0 0 20 20" aria-hidden="true">
        <path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="app-select-pop">
        <div
          v-if="open"
          class="app-select-panel"
          data-open="true"
          :style="panelStyle"
          role="listbox"
        >
          <button
            v-for="(option, index) in options"
            :key="`${option.value}-${index}`"
            type="button"
            class="app-select-option"
            :class="{ 'is-selected': option.value === modelValue, 'is-active': index === activeIndex }"
            :disabled="option.disabled"
            role="option"
            :aria-selected="option.value === modelValue"
            @pointerenter="activeIndex = index"
            @click="choose(option)"
          >
            <span>{{ option.label }}</span>
            <span v-if="option.value === modelValue" class="app-select-check">✓</span>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-select{width:100%;min-width:0}
.app-select-trigger{width:100%;height:40px;min-height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 11px 0 12px;border:0;background:transparent;color:var(--color-text,#111827);font:inherit;text-align:left;cursor:pointer;outline:none}
.app-select-trigger:disabled{cursor:not-allowed;opacity:.55}
.app-select-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-select-trigger.is-placeholder .app-select-label{color:var(--color-text-muted,#64748b)}
.app-select-chevron{width:18px;height:18px;flex:0 0 18px;transition:transform .16s ease;color:var(--color-text-muted,#64748b)}
.app-select-trigger.is-open .app-select-chevron{transform:rotate(180deg)}
</style>

<style>
.app-select-panel{max-height:280px;overflow:auto;padding:6px;border:1px solid var(--color-border,#d6deea);border-radius:11px;background:var(--color-surface,#fff);box-shadow:0 14px 38px rgba(15,23,42,.16),0 4px 12px rgba(15,23,42,.08)}
.app-select-option{width:100%;min-height:38px;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--color-text,#111827);display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;font:inherit;cursor:pointer}
.app-select-option:hover,.app-select-option.is-active{background:color-mix(in srgb,var(--color-primary,#2563eb) 7%,#fff)}
.app-select-option.is-selected{color:var(--color-primary,#2563eb);font-weight:700;background:color-mix(in srgb,var(--color-primary,#2563eb) 9%,#fff)}
.app-select-option:disabled{opacity:.45;cursor:not-allowed}
.app-select-check{font-size:14px;font-weight:800}
.app-select-pop-enter-active,.app-select-pop-leave-active{transition:opacity .14s ease,transform .14s ease}
.app-select-pop-enter-from,.app-select-pop-leave-to{opacity:0;transform:translateY(-4px) scale(.985)}
@media (prefers-reduced-motion:reduce){.app-select-pop-enter-active,.app-select-pop-leave-active,.app-select-chevron{transition:none!important}}
</style>
