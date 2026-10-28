<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}>(), {
  disabled: false,
  placeholder: 'Select expiry date',
  ariaLabel: 'Select expiry year, month and date'
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
}>();

type ViewMode = 'years' | 'months' | 'days';
const open = ref(false);
const viewMode = ref<ViewMode>('years');
const trigger = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const now = new Date();
const selectedYear = ref(now.getFullYear());
const selectedMonth = ref(now.getMonth());
const decadeStart = ref(Math.floor(now.getFullYear() / 10) * 10);
const exactDay = ref('');

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(2024, month, 1))
);
const weekNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function parseIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}
function isoDate(year:number, monthIndex:number, day:number) {
  return `${year}-${String(monthIndex + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function monthEndIso(year:number, monthIndex:number) { return isoDate(year, monthIndex, new Date(year, monthIndex + 1, 0).getDate()); }

const displayValue = computed(() => {
  const date = parseIso(props.modelValue);
  if (!date) return props.placeholder;
  return new Intl.DateTimeFormat(undefined, { day:'2-digit', month:'short', year:'numeric' }).format(date);
});
const years = computed(() => Array.from({ length:10 }, (_, index) => decadeStart.value + index));
const decadeLabel = computed(() => `${decadeStart.value} - ${decadeStart.value + 9}`);
const selectedDate = computed(() => parseIso(props.modelValue));
const monthTitle = computed(() => `${monthNames[selectedMonth.value]} ${selectedYear.value}`);
const daysInMonth = computed(() => new Date(selectedYear.value, selectedMonth.value + 1, 0).getDate());
const dayCells = computed(() => {
  const first = new Date(selectedYear.value, selectedMonth.value, 1).getDay();
  const count = new Date(selectedYear.value, selectedMonth.value + 1, 0).getDate();
  return [...Array.from({length:first}, () => 0), ...Array.from({length:count}, (_,i) => i + 1)];
});

function syncFromValue(value:string) {
  const date = parseIso(value) || new Date();
  selectedYear.value = date.getFullYear();
  selectedMonth.value = date.getMonth();
  decadeStart.value = Math.floor(selectedYear.value / 10) * 10;
}
function positionPanel() {
  if (!trigger.value || !open.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const width = Math.min(350, window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
  const estimatedHeight = viewMode.value === 'days' ? 430 : 360;
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
  panelStyle.value = { position:'fixed', width:`${width}px`, left:`${left}px`, top:placeAbove?'auto':`${rect.bottom+6}px`, bottom:placeAbove?`${window.innerHeight-rect.top+6}px`:'auto', zIndex:'10110' };
}
async function toggle() {
  if (props.disabled) return;
  if (!open.value) { syncFromValue(props.modelValue); viewMode.value='years'; }
  open.value = !open.value;
  if (open.value) { await nextTick(); positionPanel(); }
}
function chooseYear(year:number) { selectedYear.value=year; viewMode.value='months'; nextTick(positionPanel); }
function chooseMonth(monthIndex:number) {
  selectedMonth.value=monthIndex;
  const date=selectedDate.value;
  exactDay.value = date && date.getFullYear()===selectedYear.value && date.getMonth()===monthIndex ? String(date.getDate()) : '';
  viewMode.value='days'; nextTick(positionPanel);
}
function chooseDay(day:number) {
  if (!day) return;
  exactDay.value=String(day);
  const value = isoDate(selectedYear.value, selectedMonth.value, day);
  emit('update:modelValue', value); emit('change', value); open.value=false; nextTick(() => trigger.value?.focus());
}
function applyExactDay() {
  const day=Number(String(exactDay.value).replace(/\D/g,''));
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth.value) return;
  chooseDay(day);
}
function useMonthEnd() { const value=monthEndIso(selectedYear.value,selectedMonth.value); emit('update:modelValue',value); emit('change',value); open.value=false; nextTick(()=>trigger.value?.focus()); }
function clear() { emit('update:modelValue',''); emit('change',''); open.value=false; nextTick(()=>trigger.value?.focus()); }
function shiftDecade(amount:number) { decadeStart.value += amount*10; }
function shiftYear(amount:number) { selectedYear.value += amount; decadeStart.value=Math.floor(selectedYear.value/10)*10; }
function shiftMonth(amount:number) { const d=new Date(selectedYear.value, selectedMonth.value+amount, 1); selectedYear.value=d.getFullYear(); selectedMonth.value=d.getMonth(); decadeStart.value=Math.floor(selectedYear.value/10)*10; exactDay.value=''; }
function backToYears() { decadeStart.value=Math.floor(selectedYear.value/10)*10; viewMode.value='years'; nextTick(positionPanel); }
function backToMonths() { viewMode.value='months'; nextTick(positionPanel); }
function onDocumentPointerDown(event:PointerEvent) { if(!open.value)return; const target=event.target as Node; if(trigger.value?.contains(target)||panel.value?.contains(target))return; open.value=false; }
function onKeydown(event:KeyboardEvent) { if(event.key==='Escape'&&open.value){ open.value=false; nextTick(()=>trigger.value?.focus()); } }
watch(() => props.modelValue, syncFromValue, { immediate:true });
watch(viewMode, () => nextTick(positionPanel));
onMounted(() => { document.addEventListener('pointerdown',onDocumentPointerDown,true); document.addEventListener('keydown',onKeydown); window.addEventListener('resize',positionPanel); window.addEventListener('scroll',positionPanel,true); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown',onDocumentPointerDown,true); document.removeEventListener('keydown',onKeydown); window.removeEventListener('resize',positionPanel); window.removeEventListener('scroll',positionPanel,true); });
</script>

<template>
  <div class="expiry-picker">
    <button ref="trigger" type="button" class="expiry-trigger" :class="{ 'is-placeholder':!modelValue,'is-open':open }" :disabled="disabled" :aria-label="ariaLabel" :aria-expanded="open" @click="toggle">
      <span>{{ displayValue }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </button>
    <Teleport to="body">
      <Transition name="expiry-pop">
        <div v-if="open" ref="panel" class="expiry-panel" :style="panelStyle" role="dialog" aria-label="Expiry date picker">
          <template v-if="viewMode==='years'">
            <div class="expiry-head"><button type="button" aria-label="Previous 10 years" @click="shiftDecade(-1)">‹</button><strong>{{ decadeLabel }}</strong><button type="button" aria-label="Next 10 years" @click="shiftDecade(1)">›</button></div>
            <div class="expiry-year-grid"><button v-for="year in years" :key="year" type="button" :class="{ 'is-selected':selectedDate?.getFullYear()===year,'is-current':new Date().getFullYear()===year }" @click="chooseYear(year)">{{ year }}</button></div>
            <div class="expiry-hint">Choose year → month → exact expiry date.</div>
          </template>
          <template v-else-if="viewMode==='months'">
            <div class="expiry-head"><button type="button" aria-label="Previous year" @click="shiftYear(-1)">‹</button><button type="button" class="expiry-year-back" @click="backToYears">{{ selectedYear }}</button><button type="button" aria-label="Next year" @click="shiftYear(1)">›</button></div>
            <div class="expiry-month-grid"><button v-for="(month,index) in monthNames" :key="month" type="button" :class="{ 'is-selected':selectedDate?.getFullYear()===selectedYear&&selectedDate?.getMonth()===index }" @click="chooseMonth(index)">{{ month }}</button></div>
            <div class="expiry-hint">Choose the expiry month.</div>
          </template>
          <template v-else>
            <div class="expiry-head"><button type="button" aria-label="Previous month" @click="shiftMonth(-1)">‹</button><button type="button" class="expiry-year-back" @click="backToMonths">{{ monthTitle }}</button><button type="button" aria-label="Next month" @click="shiftMonth(1)">›</button></div>
            <div class="expiry-week-grid"><span v-for="name in weekNames" :key="name">{{ name }}</span></div>
            <div class="expiry-day-grid"><span v-for="(day,index) in dayCells" :key="`${selectedYear}-${selectedMonth}-${index}`" :class="{empty:!day}"><button v-if="day" type="button" :class="{ 'is-selected':selectedDate?.getFullYear()===selectedYear&&selectedDate?.getMonth()===selectedMonth&&selectedDate?.getDate()===day,'is-current':new Date().getFullYear()===selectedYear&&new Date().getMonth()===selectedMonth&&new Date().getDate()===day }" @click="chooseDay(day)">{{ day }}</button></span></div>
            <div class="expiry-exact-row"><label><span>Exact day</span><input v-model="exactDay" type="text" inputmode="numeric" maxlength="2" :placeholder="`1-${daysInMonth}`" @keydown.enter.prevent="applyExactDay"></label><button type="button" @click="applyExactDay">Apply date</button></div>
            <div class="expiry-hint">Pick the date, type the exact day, or use Month End when the package shows only month/year.</div>
          </template>
          <div class="expiry-footer"><button type="button" @click="clear">Clear</button><button v-if="viewMode==='months'" type="button" class="is-primary" @click="backToYears">Choose year</button><button v-else-if="viewMode==='days'" type="button" class="is-primary" @click="useMonthEnd">Use month end</button></div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.expiry-picker{width:100%;min-width:0}.expiry-trigger{width:100%;height:40px;min-height:40px;padding:0 11px 0 12px;border:1px solid var(--color-border,#d6deea);border-radius:8px;background:var(--color-surface,#fff);color:var(--color-text,#111827);display:flex;align-items:center;justify-content:space-between;gap:10px;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease}.expiry-trigger:hover{border-color:color-mix(in srgb,var(--color-primary,#2563eb) 45%,var(--color-border,#d6deea))}.expiry-trigger:focus-visible,.expiry-trigger.is-open{outline:none;border-color:var(--color-primary,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb,var(--color-primary,#2563eb) 12%,transparent)}.expiry-trigger.is-placeholder span{color:var(--color-text-muted,#64748b)}.expiry-trigger svg{width:18px;height:18px;flex:0 0 18px;color:var(--color-text-muted,#64748b)}
</style>
<style>
.expiry-panel{padding:12px;border:1px solid var(--color-border,#d6deea);border-radius:14px;background:var(--color-surface,#fff);color:var(--color-text,#111827);box-shadow:0 18px 46px rgba(15,23,42,.17),0 4px 12px rgba(15,23,42,.08)}.expiry-head{display:grid;grid-template-columns:38px 1fr 38px;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--color-border,#e5eaf1)}.expiry-head strong{text-align:center;font-size:15px}.expiry-head button,.expiry-year-grid button,.expiry-month-grid button,.expiry-day-grid button,.expiry-footer button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:9px}.expiry-head>button{width:38px;height:36px;font-size:27px;line-height:1;color:var(--color-text-muted,#64748b)}.expiry-head button:hover,.expiry-year-grid button:hover,.expiry-month-grid button:hover,.expiry-day-grid button:hover,.expiry-footer button:hover{background:color-mix(in srgb,var(--color-primary,#2563eb) 8%,var(--color-surface,#fff))}.expiry-year-back{width:auto!important;font-size:15px!important;font-weight:750;color:var(--color-text,#111827)!important;justify-self:stretch}.expiry-year-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;padding:10px 0 4px}.expiry-year-grid button{height:39px;font-size:14px}.expiry-month-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:12px 0 6px}.expiry-month-grid button{height:42px;font-size:13px;font-weight:650}.expiry-week-grid,.expiry-day-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.expiry-week-grid{padding:10px 0 4px;color:var(--color-text-muted,#64748b);font-size:10px;text-align:center;font-weight:700}.expiry-day-grid{padding-bottom:5px}.expiry-day-grid span{min-height:36px;display:grid;place-items:center}.expiry-day-grid button{width:34px;height:34px;font-size:12px}.expiry-year-grid button.is-current,.expiry-day-grid button.is-current{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--color-primary,#2563eb) 42%,transparent)}.expiry-year-grid button.is-selected,.expiry-month-grid button.is-selected,.expiry-day-grid button.is-selected{background:var(--color-primary,#2563eb);color:#fff;font-weight:750}.expiry-exact-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin:7px 2px 2px;padding-top:8px;border-top:1px solid var(--color-border,#e5eaf1)}.expiry-exact-row label{display:grid;gap:4px;color:var(--color-text-muted,#64748b);font-size:10px;font-weight:700}.expiry-exact-row input{height:34px;min-width:0;border:1px solid var(--color-border,#d6deea);border-radius:8px;background:var(--color-surface,#fff);color:var(--color-text,#111827);padding:0 10px;font:inherit;font-size:12px}.expiry-exact-row input:focus{outline:none;border-color:var(--color-primary,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb,var(--color-primary,#2563eb) 10%,transparent)}.expiry-exact-row button{height:34px;padding:0 11px;border:0;border-radius:8px;background:color-mix(in srgb,var(--color-primary,#2563eb) 10%,var(--color-surface,#fff));color:var(--color-primary,#2563eb);font:inherit;font-size:11px;font-weight:750;cursor:pointer}.expiry-hint{padding:8px 4px 2px;text-align:center;font-size:11px;color:var(--color-text-muted,#64748b)}.expiry-footer{display:flex;justify-content:space-between;gap:8px;margin-top:8px;padding-top:10px;border-top:1px solid var(--color-border,#e5eaf1)}.expiry-footer button{min-height:34px;padding:0 10px;color:var(--color-text-muted,#64748b);font-size:12px;font-weight:700}.expiry-footer button.is-primary{color:var(--color-primary,#2563eb)}.expiry-pop-enter-active,.expiry-pop-leave-active{transition:opacity .14s ease,transform .14s ease}.expiry-pop-enter-from,.expiry-pop-leave-to{opacity:0;transform:translateY(-4px) scale(.985)}@media(max-width:420px){.expiry-panel{padding:10px}}@media(prefers-reduced-motion:reduce){.expiry-pop-enter-active,.expiry-pop-leave-active{transition:none!important}}
</style>
