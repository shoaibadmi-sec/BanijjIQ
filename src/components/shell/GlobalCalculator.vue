<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { evaluateCalculatorExpression, formatCalculatorNumber } from './calculator';

const STORAGE_KEY = 'shererp.calc.lines';

const open = ref(false);
const lines = ref<string[]>(['']);
const activeIndex = ref(0);
const toggleButton = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const linesContainer = ref<HTMLElement | null>(null);
const inputRefs = new Map<number, HTMLInputElement>();
const rowRefs = new Map<number, HTMLElement>();

const evaluations = computed(() => lines.value.map((expression) => evaluateCalculatorExpression(expression)));
const total = computed(() => {
  return lines.value.reduce((sum, expression, index) => {
    const result = evaluations.value[index];
    return expression.trim() && result && !result.error ? sum + result.value : sum;
  }, 0);
});

function loadLines(): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) {
      lines.value = parsed.map((value) => String(value));
      activeIndex.value = lines.value.length - 1;
      return;
    }
  } catch {
    // Storage may be blocked or contain invalid JSON. Calculator still works in-memory.
  }
  lines.value = [''];
  activeIndex.value = 0;
}

function saveLines(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.value));
  } catch {
    // Non-persistent scratchpad is an acceptable fallback when storage is unavailable.
  }
}

function setInputRef(index: number, element: unknown): void {
  if (element instanceof HTMLInputElement) inputRefs.set(index, element);
  else inputRefs.delete(index);
}

function setRowRef(index: number, element: unknown): void {
  if (element instanceof HTMLElement) rowRefs.set(index, element);
  else rowRefs.delete(index);
}

function clampActiveIndex(): number {
  if (activeIndex.value >= lines.value.length) activeIndex.value = lines.value.length - 1;
  if (activeIndex.value < 0) activeIndex.value = 0;
  return activeIndex.value;
}

function ensureRowVisible(index: number): void {
  const container = linesContainer.value;
  const row = rowRefs.get(index);
  if (!container || !row) return;

  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const padding = 6;

  if (rowRect.bottom > containerRect.bottom) {
    container.scrollTop += rowRect.bottom - containerRect.bottom + padding;
  } else if (rowRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - rowRect.top + padding;
  }
}

function moveCursorToEnd(input: HTMLInputElement | undefined): void {
  if (!input) return;
  const end = input.value.length;
  try {
    input.setSelectionRange(end, end);
  } catch {
    // Old browsers can reject selection operations on readonly inputs.
  }
}

function focusLine(index: number): void {
  const safeIndex = Math.max(0, Math.min(Number(index) || 0, lines.value.length - 1));
  // Set the logical destination synchronously. Rapid physical typing immediately
  // after Enter therefore belongs to the new row even before Vue's next DOM tick.
  activeIndex.value = safeIndex;

  const input = inputRefs.get(safeIndex);
  if (!input) return;

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  moveCursorToEnd(input);
  ensureRowVisible(safeIndex);
}

async function focusLineAfterRender(index: number): Promise<void> {
  activeIndex.value = Math.max(0, Math.min(index, lines.value.length - 1));
  await nextTick();
  focusLine(activeIndex.value);
}

function selectionForLine(index: number): { start: number; end: number } {
  const expression = lines.value[index] || '';
  const input = inputRefs.get(index);
  if (!input) return { start: expression.length, end: expression.length };

  const start = input.selectionStart ?? expression.length;
  const end = input.selectionEnd ?? expression.length;
  return { start, end };
}

async function restoreCursor(index: number, position: number): Promise<void> {
  await nextTick();
  const input = inputRefs.get(index);
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  try {
    input.setSelectionRange(position, position);
  } catch {
    // Ignore selection failure on older browsers.
  }
  ensureRowVisible(index);
}

function updateLine(index: number, value: string): void {
  lines.value[index] = value;
  saveLines();
}

function insertText(text: string): void {
  const index = clampActiveIndex();
  const expression = lines.value[index] || '';
  const selection = selectionForLine(index);
  const nextValue = expression.slice(0, selection.start) + text + expression.slice(selection.end);
  const nextPosition = selection.start + text.length;

  updateLine(index, nextValue);
  void restoreCursor(index, nextPosition);
}

function backspace(): void {
  const index = clampActiveIndex();
  const expression = lines.value[index] || '';
  const selection = selectionForLine(index);

  if (selection.start !== selection.end) {
    updateLine(index, expression.slice(0, selection.start) + expression.slice(selection.end));
    void restoreCursor(index, selection.start);
    return;
  }

  if (selection.start > 0) {
    const position = selection.start - 1;
    updateLine(index, expression.slice(0, position) + expression.slice(selection.start));
    void restoreCursor(index, position);
    return;
  }

  if (!expression && index > 0) removeLine(index);
}

function clearLine(): void {
  const index = clampActiveIndex();
  updateLine(index, '');
  void restoreCursor(index, 0);
}

function addOrAdvanceLine(): void {
  const index = clampActiveIndex();
  if (index < lines.value.length - 1) {
    void focusLineAfterRender(index + 1);
    return;
  }

  lines.value.push('');
  // Critical focus fix: logical active row is changed immediately before waiting
  // for the new DOM row. This prevents fast typing from landing on the old row.
  activeIndex.value = lines.value.length - 1;
  saveLines();
  void focusLineAfterRender(activeIndex.value);
}

function removeLine(index: number): void {
  if (lines.value.length <= 1) {
    lines.value = [''];
    saveLines();
    void focusLineAfterRender(0);
    return;
  }

  lines.value.splice(index, 1);
  saveLines();
  void focusLineAfterRender(Math.max(0, index - 1));
}

function clearAll(): void {
  lines.value = [''];
  activeIndex.value = 0;
  saveLines();
  void focusLineAfterRender(0);
}

function selectLine(index: number): void {
  activeIndex.value = index;
  const input = inputRefs.get(index);
  moveCursorToEnd(input);
  ensureRowVisible(index);
}

function openCalculator(): void {
  open.value = true;
  activeIndex.value = lines.value.length - 1;
  void focusLineAfterRender(activeIndex.value);
}

function closeCalculator(): void {
  open.value = false;
}

function toggleCalculator(): void {
  if (open.value) closeCalculator();
  else openCalculator();
}

function onDocumentClick(event: MouseEvent): void {
  if (!open.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (panel.value?.contains(target) || toggleButton.value?.contains(target)) return;
  closeCalculator();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (!open.value || event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeCalculator();
    return;
  }

  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    insertText(event.key);
    return;
  }

  const insertMap: Record<string, string> = {
    '+': '+',
    '-': '-',
    '*': '×',
    x: '×',
    X: '×',
    '/': '÷',
    '.': '.',
    ',': '.',
    '(': '(',
    ')': ')',
    '%': '%'
  };

  if (Object.prototype.hasOwnProperty.call(insertMap, event.key)) {
    event.preventDefault();
    insertText(insertMap[event.key]);
    return;
  }

  if (event.key === 'Enter' || event.key === '=') {
    event.preventDefault();
    addOrAdvanceLine();
    return;
  }

  if (event.key === 'Backspace') {
    event.preventDefault();
    backspace();
    return;
  }

  if (event.key === 'Delete') {
    event.preventDefault();
    clearLine();
  }
}

function displayResult(index: number): string {
  const expression = lines.value[index] || '';
  if (!expression.trim()) return '';
  const result = evaluations.value[index];
  return result?.error ? 'err' : `= ${formatCalculatorNumber(result.value)}`;
}

function hasError(index: number): boolean {
  const expression = lines.value[index] || '';
  return !!expression.trim() && !!evaluations.value[index]?.error;
}

onMounted(() => {
  loadLines();
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <button
    ref="toggleButton"
    type="button"
    class="calc-toggle-btn"
    :class="{ 'is-active': open }"
    title="Calculator"
    aria-label="Calculator"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click.stop="toggleCalculator"
  >
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M7 6h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
      <circle cx="12" cy="11" r="1" fill="currentColor" />
      <circle cx="16.5" cy="11" r="1" fill="currentColor" />
      <circle cx="7.5" cy="15" r="1" fill="currentColor" />
      <circle cx="12" cy="15" r="1" fill="currentColor" />
      <circle cx="16.5" cy="15" r="1" fill="currentColor" />
      <circle cx="7.5" cy="19" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
      <rect x="14.3" y="17" width="3.5" height="4" rx="0.6" fill="currentColor" />
    </svg>
  </button>

  <Teleport to="body">
    <section
      v-if="open"
      ref="panel"
      class="calc-panel"
      role="dialog"
      aria-label="Calculator"
      @click.stop
    >
      <div class="calc-panel-header">
        <div>
          <h3>Calculator</h3>
          <span class="calc-panel-hint">দ্রুত হিসাব</span>
        </div>
        <div class="calc-panel-actions">
          <button type="button" class="calc-clear-btn" title="Clear all lines" @click="clearAll">Clear</button>
          <button type="button" class="calc-close-btn" aria-label="Close calculator" @click="closeCalculator">×</button>
        </div>
      </div>

      <div ref="linesContainer" class="calc-lines">
        <div
          v-for="(expression, index) in lines"
          :key="index"
          :ref="(element) => setRowRef(index, element)"
          class="calc-line"
          :class="{ 'is-active': activeIndex === index }"
        >
          <span class="calc-line-no">{{ index + 1 }}</span>
          <input
            :ref="(element) => setInputRef(index, element)"
            :value="expression"
            type="text"
            inputmode="none"
            readonly
            aria-readonly="true"
            autocomplete="off"
            spellcheck="false"
            class="calc-line-input"
            :class="{ 'has-error': hasError(index) }"
            placeholder="Tap calculator keys"
            @focus="activeIndex = index"
            @pointerdown="selectLine(index)"
            @click="selectLine(index)"
          />
          <span class="calc-line-result">{{ displayResult(index) }}</span>
          <button type="button" class="calc-line-remove" aria-label="Remove line" @click="removeLine(index)">×</button>
        </div>
      </div>

      <div class="calc-total-row">
        <span>Total</span>
        <span class="calc-total-value">{{ formatCalculatorNumber(total) }}</span>
      </div>

      <div class="calc-keypad" @mousedown.prevent>
        <button type="button" class="calc-key calc-key-fn" @click="insertText('(')">(</button>
        <button type="button" class="calc-key calc-key-fn" @click="insertText(')')">)</button>
        <button type="button" class="calc-key calc-key-fn" aria-label="Backspace" @click="backspace">⌫</button>
        <button type="button" class="calc-key calc-key-fn" @click="clearLine">C</button>

        <button type="button" class="calc-key" @click="insertText('7')">7</button>
        <button type="button" class="calc-key" @click="insertText('8')">8</button>
        <button type="button" class="calc-key" @click="insertText('9')">9</button>
        <button type="button" class="calc-key calc-key-op" @click="insertText('÷')">÷</button>

        <button type="button" class="calc-key" @click="insertText('4')">4</button>
        <button type="button" class="calc-key" @click="insertText('5')">5</button>
        <button type="button" class="calc-key" @click="insertText('6')">6</button>
        <button type="button" class="calc-key calc-key-op" @click="insertText('×')">×</button>

        <button type="button" class="calc-key" @click="insertText('1')">1</button>
        <button type="button" class="calc-key" @click="insertText('2')">2</button>
        <button type="button" class="calc-key" @click="insertText('3')">3</button>
        <button type="button" class="calc-key calc-key-op" @click="insertText('-')">−</button>

        <button type="button" class="calc-key calc-key-fn" @click="insertText('%')">%</button>
        <button type="button" class="calc-key" @click="insertText('0')">0</button>
        <button type="button" class="calc-key" @click="insertText('.')">.</button>
        <button type="button" class="calc-key calc-key-op" @click="insertText('+')">+</button>

        <button type="button" class="calc-key calc-key-equals" @click="addOrAdvanceLine">=</button>
      </div>
    </section>
  </Teleport>
</template>
