<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onToast, type ToastPayload, type ToastType } from '../../utils/notify';

type ToastItem = ToastPayload & { id: number };

const items = ref<ToastItem[]>([]);
let sequence = 0;
let stopListening: (() => void) | null = null;
const timers = new Map<number, number>();

function remove(id: number): void {
  items.value = items.value.filter((item) => item.id !== id);
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
}

function add(payload: ToastPayload): void {
  const id = ++sequence;
  const item: ToastItem = { ...payload, id };
  items.value = [...items.value.slice(-3), item];
  const duration = Math.max(1800, Math.min(payload.duration ?? 3200, 10000));
  timers.set(id, window.setTimeout(() => remove(id), duration));
}

function iconPath(type: ToastType): string {
  if (type === 'success') return 'M9 12.75 11.25 15 15 9.75';
  if (type === 'error') return 'm9.75 9.75 4.5 4.5m0-4.5-4.5 4.5';
  if (type === 'warning') return 'M12 9v3.75m0 3.75h.008v.008H12V16.5Z';
  return 'M11.25 11.25 12 10.5m0 0 .75.75M12 10.5v4.5';
}

onMounted(() => { stopListening = onToast(add); });
onBeforeUnmount(() => {
  stopListening?.();
  timers.forEach((timer) => window.clearTimeout(timer));
  timers.clear();
});
</script>

<template>
  <div class="global-toast-stack" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast-pop">
      <div v-for="item in items" :key="item.id" class="global-toast" :class="`is-${item.type}`" role="status">
        <span class="global-toast-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle v-if="item.type === 'success' || item.type === 'error' || item.type === 'info'" cx="12" cy="12" r="9" />
            <path v-if="item.type === 'warning'" d="M10.3 4.4 3.1 17a2 2 0 0 0 1.7 3h14.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
            <path :d="iconPath(item.type)" />
          </svg>
        </span>
        <span class="global-toast-message">{{ item.message }}</span>
        <button class="global-toast-close" type="button" aria-label="Dismiss notification" @click="remove(item.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.global-toast-stack{position:fixed;top:78px;right:18px;z-index:20000;display:grid;gap:10px;width:min(390px,calc(100vw - 32px));pointer-events:none}.global-toast{--toast-bg:#eff6ff;--toast-text:#1e3a8a;--toast-border:#bfdbfe;display:grid;grid-template-columns:30px minmax(0,1fr) 30px;align-items:center;gap:10px;min-height:58px;padding:10px 10px 10px 14px;border:1px solid var(--toast-border);border-radius:13px;background:var(--toast-bg);color:var(--toast-text);box-shadow:0 12px 30px rgba(15,23,42,.17);pointer-events:auto}.global-toast.is-success{--toast-bg:#d9f7ef;--toast-text:#0f766e;--toast-border:#99ead9}.global-toast.is-error{--toast-bg:#fee7e7;--toast-text:#b42318;--toast-border:#fecaca}.global-toast.is-warning{--toast-bg:#fff3d6;--toast-text:#9a6700;--toast-border:#f6d88b}.global-toast.is-info{--toast-bg:#e8f1ff;--toast-text:#2458a6;--toast-border:#bfd5ff}.global-toast-icon{display:grid;place-items:center;width:30px;height:30px}.global-toast-icon svg{width:26px;height:26px}.global-toast-message{font-size:14px;line-height:1.35;font-weight:700;overflow-wrap:anywhere}.global-toast-close{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:currentColor;font-size:24px;line-height:1;cursor:pointer;opacity:.7}.global-toast-close:hover{background:rgba(255,255,255,.55);opacity:1}.toast-pop-enter-active,.toast-pop-leave-active{transition:opacity .2s ease,transform .2s ease}.toast-pop-enter-from,.toast-pop-leave-to{opacity:0;transform:translateY(-8px) scale(.98)}@media(max-width:640px){.global-toast-stack{top:12px;left:50%;right:auto;transform:translateX(-50%);width:calc(100vw - 24px)}.global-toast{min-height:56px;border-radius:12px}.global-toast-message{font-size:14px}}@media(prefers-reduced-motion:reduce){.toast-pop-enter-active,.toast-pop-leave-active{transition:none}}
</style>
