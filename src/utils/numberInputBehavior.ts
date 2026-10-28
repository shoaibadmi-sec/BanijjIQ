const INSTALLED_KEY = '__shererpNumberInputBehaviorInstalled';

type SherErpGlobal = typeof globalThis & {
  [INSTALLED_KEY]?: boolean;
};

function isNumberInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === 'number';
}

function numericAttribute(input: HTMLInputElement, name: 'min' | 'max'): number | null {
  const raw = input.getAttribute(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isIntegerInput(input: HTMLInputElement): boolean {
  if (input.dataset.integer === 'true') return true;
  if (input.dataset.integer === 'false') return false;

  const step = input.getAttribute('step');
  if (step === null || step.trim() === '' || step === 'any') return false;
  const parsed = Number(step);
  return Number.isFinite(parsed) && parsed === 1;
}

function clampInteger(input: HTMLInputElement, value: number): number {
  let next = Math.round(value);
  const min = numericAttribute(input, 'min');
  const max = numericAttribute(input, 'max');

  if (min !== null) next = Math.max(Math.ceil(min), next);
  if (max !== null) next = Math.min(Math.floor(max), next);
  return next;
}

function normalizeIntegerValue(input: HTMLInputElement): void {
  if (!isIntegerInput(input)) return;

  const raw = input.value.trim();
  if (raw === '') return;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;

  const normalized = String(clampInteger(input, parsed));
  if (input.value === normalized) return;

  input.value = normalized;
  // Vue v-model.number listens to the input event, so keep the model in sync
  // when a pasted/typed decimal is normalized on change/blur.
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function onKeyDown(event: KeyboardEvent): void {
  if (!isNumberInput(event.target)) return;
  const input = event.target;
  if (!isIntegerInput(input)) return;

  // Integer/count fields must not accept decimal/exponent notation. Minus is
  // intentionally allowed because stock adjustment can be negative.
  if (event.key === '.' || event.key === ',' || event.key === 'e' || event.key === 'E') {
    event.preventDefault();
    return;
  }

  // If old/imported data contains a fractional value, normalize it before the
  // browser applies ArrowUp/ArrowDown so the next native step is exactly 1.
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    normalizeIntegerValue(input);
  }
}

function onChange(event: Event): void {
  if (!isNumberInput(event.target)) return;
  normalizeIntegerValue(event.target);
}

function onWheel(event: WheelEvent): void {
  if (!isNumberInput(event.target)) return;
  const input = event.target;

  // A focused <input type="number"> may consume the mouse wheel and silently
  // change its value. Blur it before the browser default action so the wheel
  // continues scrolling the page instead of changing quantity/money values.
  if (document.activeElement === input) input.blur();
}

/**
 * Installs one app-wide behavior layer for native number inputs.
 *
 * - step="1" (or data-integer="true") fields are whole-number only.
 * - Arrow controls continue to work using the declared step.
 * - Decimal money/price fields such as step="0.01" remain decimal.
 * - Mouse-wheel scrolling cannot accidentally change a focused number field.
 */
export function installGlobalNumberInputBehavior(): void {
  if (typeof document === 'undefined') return;

  const state = globalThis as SherErpGlobal;
  if (state[INSTALLED_KEY]) return;
  state[INSTALLED_KEY] = true;

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: true });
}
