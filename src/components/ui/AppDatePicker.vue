<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}>(), {
  disabled: false,
  placeholder: 'Select date',
  ariaLabel: 'Select date'
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
}>();

const open = ref(false);
const trigger = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const viewDate = ref(new Date());
const weekdays = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function parseIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplay(value: string) {
  const date = parseIso(value);
  if (!date) return props.placeholder;
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

const displayValue = computed(() => formatDisplay(props.modelValue));
const monthTitle = computed(() => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(viewDate.value));
const calendarDays = computed(() => {
  const year = viewDate.value.getFullYear();
  const month = viewDate.value.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { iso: toIso(date), day: date.getDate(), currentMonth: date.getMonth() === month, today: toIso(date) === toIso(new Date()) };
  });
});

function positionPanel() {
  if (!trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const panelWidth = Math.min(320, window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - panelWidth - 8));
  const estimatedHeight = 360;
  const placeAbove = window.innerHeight - rect.bottom < estimatedHeight && rect.top > window.innerHeight - rect.bottom;
  panelStyle.value = {
    position: 'fixed',
    width: `${panelWidth}px`,
    left: `${left}px`,
    top: placeAbove ? 'auto' : `${rect.bottom + 6}px`,
    bottom: placeAbove ? `${window.innerHeight - rect.top + 6}px` : 'auto',
    zIndex: '10090'
  };
}

async function toggle() {
  if (props.disabled) return;
  const selected = parseIso(props.modelValue);
  if (selected) viewDate.value = new Date(selected.getFullYear(), selected.getMonth(), 1);
  open.value = !open.value;
  if (open.value) {
    await nextTick();
    positionPanel();
  }
}

function choose(value: string) {
  emit('update:modelValue', value);
  emit('change', value);
  open.value = false;
  nextTick(() => trigger.value?.focus());
}

function shiftMonth(amount: number) {
  viewDate.value = new Date(viewDate.value.getFullYear(), viewDate.value.getMonth() + amount, 1);
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target as Node;
  if (trigger.value?.contains(target)) return;
  const panel = document.querySelector('.app-date-panel[data-open="true"]');
  if (panel?.contains(target)) return;
  open.value = false;
}

watch(() => props.modelValue, (value) => {
  const selected = parseIso(value);
  if (selected) viewDate.value = new Date(selected.getFullYear(), selected.getMonth(), 1);
}, { immediate: true });

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
  <div class="app-date-picker">
    <button ref="trigger" type="button" class="app-date-trigger" :class="{ 'is-placeholder': !modelValue, 'is-open': open }" :disabled="disabled" :aria-label="ariaLabel" :aria-expanded="open" @click="toggle" @keydown.esc="open = false">
      <span>{{ displayValue }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </button>
    <Teleport to="body">
      <Transition name="app-date-pop">
        <div v-if="open" class="app-date-panel" data-open="true" :style="panelStyle">
          <div class="app-date-head">
            <button type="button" aria-label="Previous month" @click="shiftMonth(-1)">‹</button>
            <strong>{{ monthTitle }}</strong>
            <button type="button" aria-label="Next month" @click="shiftMonth(1)">›</button>
          </div>
          <div class="app-date-weekdays"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
          <div class="app-date-grid">
            <button v-for="day in calendarDays" :key="day.iso" type="button" :class="{ 'is-muted': !day.currentMonth, 'is-selected': day.iso === modelValue, 'is-today': day.today }" @click="choose(day.iso)">{{ day.day }}</button>
          </div>
          <div class="app-date-footer">
            <button type="button" @click="choose('')">Clear</button>
            <button type="button" class="is-primary" @click="choose(toIso(new Date()))">Today</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-date-picker{width:100%;min-width:0}
.app-date-trigger{width:100%;height:40px;min-height:40px;padding:0 11px 0 12px;border:1px solid var(--color-border,#d6deea);border-radius:8px;background:var(--color-surface,#fff);color:var(--color-text,#111827);display:flex;align-items:center;justify-content:space-between;gap:10px;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease}
.app-date-trigger:hover{border-color:color-mix(in srgb,var(--color-primary,#2563eb) 45%,var(--color-border,#d6deea))}
.app-date-trigger:focus-visible,.app-date-trigger.is-open{outline:none;border-color:var(--color-primary,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb,var(--color-primary,#2563eb) 12%,transparent)}
.app-date-trigger.is-placeholder span{color:var(--color-text-muted,#64748b)}
.app-date-trigger svg{width:18px;height:18px;flex:0 0 18px;color:var(--color-text-muted,#64748b)}
</style>

<style>
.app-date-panel{padding:12px;border:1px solid var(--color-border,#d6deea);border-radius:12px;background:var(--color-surface,#fff);box-shadow:0 16px 42px rgba(15,23,42,.16),0 4px 12px rgba(15,23,42,.08)}
.app-date-head{display:grid;grid-template-columns:36px 1fr 36px;align-items:center;gap:6px;margin-bottom:8px}
.app-date-head strong{text-align:center;font-size:14px}
.app-date-head button,.app-date-grid button,.app-date-footer button{border:0;background:transparent;color:var(--color-text,#111827);font:inherit;cursor:pointer;border-radius:8px}
.app-date-head button{width:36px;height:34px;font-size:22px}
.app-date-head button:hover,.app-date-grid button:hover,.app-date-footer button:hover{background:color-mix(in srgb,var(--color-primary,#2563eb) 7%,#fff)}
.app-date-weekdays,.app-date-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.app-date-weekdays{margin-bottom:4px;color:var(--color-text-muted,#64748b);font-size:11px;font-weight:700;text-align:center}
.app-date-weekdays span{padding:5px 0}
.app-date-grid button{height:34px;font-size:13px}
.app-date-grid button.is-muted{color:color-mix(in srgb,var(--color-text-muted,#64748b) 58%,transparent)}
.app-date-grid button.is-today{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--color-primary,#2563eb) 48%,transparent)}
.app-date-grid button.is-selected{background:var(--color-primary,#2563eb);color:#fff;font-weight:700}
.app-date-footer{display:flex;justify-content:space-between;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border,#e5eaf1)}
.app-date-footer button{min-height:34px;padding:0 10px;color:var(--color-text-muted,#64748b);font-size:12px;font-weight:700}
.app-date-footer button.is-primary{color:var(--color-primary,#2563eb)}
.app-date-pop-enter-active,.app-date-pop-leave-active{transition:opacity .14s ease,transform .14s ease}
.app-date-pop-enter-from,.app-date-pop-leave-to{opacity:0;transform:translateY(-4px) scale(.985)}
@media (prefers-reduced-motion:reduce){.app-date-pop-enter-active,.app-date-pop-leave-active{transition:none!important}}
</style>
