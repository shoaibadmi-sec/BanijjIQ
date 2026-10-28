<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const barRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const innerWidth = ref(0);

let contentEl: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;
let mutationObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let frame = 0;
let syncing = false;

function isRendered(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function isHorizontalScroller(el: HTMLElement): boolean {
  if (!isRendered(el)) return false;
  const style = window.getComputedStyle(el);
  const canScroll = style.overflowX === 'auto' || style.overflowX === 'scroll';
  return canScroll && el.scrollWidth - el.clientWidth > 2;
}

function collectTargets(content: HTMLElement): HTMLElement[] {
  const found = new Set<HTMLElement>();

  content.querySelectorAll<HTMLElement>('[data-global-hscroll]:not([data-global-hscroll="off"])').forEach((el) => {
    if (isHorizontalScroller(el)) found.add(el);
  });

  content.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
    let parent = table.parentElement;
    while (parent && parent !== content) {
      if (parent.dataset.globalHscroll === 'off') break;
      if (isHorizontalScroller(parent)) {
        found.add(parent);
        break;
      }
      parent = parent.parentElement;
    }
  });

  return Array.from(found);
}

function chooseVisibleTarget(content: HTMLElement): HTMLElement | null {
  const contentRect = content.getBoundingClientRect();
  const candidates = collectTargets(content)
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => {
      const visibleHeight = Math.min(rect.bottom, contentRect.bottom) - Math.max(rect.top, contentRect.top);
      const visibleWidth = Math.min(rect.right, contentRect.right) - Math.max(rect.left, contentRect.left);
      return visibleHeight > 8 && visibleWidth > 8;
    });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aTop = Math.max(a.rect.top, contentRect.top);
    const bTop = Math.max(b.rect.top, contentRect.top);
    if (Math.abs(aTop - bTop) > 2) return aTop - bTop;
    return a.rect.left - b.rect.left;
  });

  return candidates[0]?.el ?? null;
}

function unbindTarget(): void {
  if (activeTarget) activeTarget.removeEventListener('scroll', onTargetScroll);
  activeTarget = null;
}

function bindTarget(target: HTMLElement | null): void {
  if (target === activeTarget) return;
  unbindTarget();
  activeTarget = target;
  if (activeTarget) activeTarget.addEventListener('scroll', onTargetScroll, { passive: true });
}

function hideBar(): void {
  visible.value = false;
  innerWidth.value = 0;
  bindTarget(null);
}

function modalIsOpen(): boolean {
  const overlays = document.querySelectorAll<HTMLElement>('.modal-overlay');
  return Array.from(overlays).some(isRendered);
}

function update(): void {
  frame = 0;
  const content = contentEl;
  if (!content || modalIsOpen()) {
    hideBar();
    return;
  }

  const target = chooseVisibleTarget(content);
  if (!target) {
    hideBar();
    return;
  }

  const maxScroll = Math.max(0, target.scrollWidth - target.clientWidth);
  if (maxScroll <= 2) {
    hideBar();
    return;
  }

  bindTarget(target);
  visible.value = true;
  // Make the floating bar's scroll range exactly match the target's scroll range.
  // This remains correct even when the table wrapper is narrower than .content.
  innerWidth.value = Math.max(1, content.clientWidth + maxScroll);

  const bar = barRef.value;
  if (bar && !syncing && Math.abs(bar.scrollLeft - target.scrollLeft) > 1) {
    syncing = true;
    bar.scrollLeft = target.scrollLeft;
    syncing = false;
  }
}

function scheduleUpdate(): void {
  if (frame) return;
  frame = window.requestAnimationFrame(update);
}

function onBarScroll(): void {
  if (syncing || !activeTarget || !barRef.value) return;
  syncing = true;
  activeTarget.scrollLeft = barRef.value.scrollLeft;
  syncing = false;
}

function onTargetScroll(): void {
  if (syncing || !activeTarget || !barRef.value) return;
  syncing = true;
  barRef.value.scrollLeft = activeTarget.scrollLeft;
  syncing = false;
}

function setup(): void {
  const bar = barRef.value;
  contentEl = bar?.closest('.main')?.querySelector<HTMLElement>('.content') ?? null;
  if (!bar || !contentEl) return;

  contentEl.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(contentEl);
  }

  if ('MutationObserver' in window) {
    mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
  }

  scheduleUpdate();
  window.setTimeout(scheduleUpdate, 250);
  window.setTimeout(scheduleUpdate, 1000);
}

onMounted(setup);

onBeforeUnmount(() => {
  if (frame) window.cancelAnimationFrame(frame);
  if (contentEl) contentEl.removeEventListener('scroll', scheduleUpdate);
  window.removeEventListener('resize', scheduleUpdate);
  mutationObserver?.disconnect();
  resizeObserver?.disconnect();
  unbindTarget();
  contentEl = null;
});
</script>

<template>
  <div
    v-show="visible"
    ref="barRef"
    class="global-floating-hscroll"
    aria-label="Horizontal table scroll"
    role="scrollbar"
    aria-orientation="horizontal"
    @scroll.passive="onBarScroll"
  >
    <div class="global-floating-hscroll-inner" :style="{ width: `${innerWidth}px` }"></div>
  </div>
</template>
