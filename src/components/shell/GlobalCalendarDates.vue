<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getSherErpCalendarDates } from './calendar';

const now = ref(new Date());
const mobileOpen = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

const dates = computed(() => getSherErpCalendarDates(now.value));

function refreshDate(): void {
  now.value = new Date();
}

function toggleMobile(): void {
  mobileOpen.value = !mobileOpen.value;
}

function closeMobile(): void {
  mobileOpen.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMobile();
}

onMounted(() => {
  refreshDate();
  // The display contains dates, not time. Updating every minute keeps it
  // correct when the ERP stays open across midnight without needless churn.
  timer = setInterval(refreshDate, 60_000);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="global-calendar" aria-label="English, Bangla and Hijri calendar dates">
    <div class="topbar-date global-calendar-desktop">
      <span>{{ dates.english }}</span>
      <span class="calendar-separator" aria-hidden="true">|</span>
      <span class="calendar-bn">{{ dates.bangla }}</span>
      <span class="calendar-separator" aria-hidden="true">|</span>
      <span class="calendar-bn">{{ dates.hijri }}</span>
    </div>

    <button
      class="icon-btn global-calendar-toggle"
      type="button"
      title="Calendar dates"
      aria-label="Show English, Bangla and Hijri dates"
      aria-haspopup="dialog"
      :aria-expanded="mobileOpen"
      @click.stop="toggleMobile"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M7 3v4M17 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <span class="global-calendar-toggle-day">{{ now.getDate() }}</span>
    </button>

    <div v-if="mobileOpen" class="global-calendar-popover" role="dialog" aria-label="Calendar dates" @click.stop>
      <div class="global-calendar-row">
        <span class="global-calendar-label">English</span>
        <strong>{{ dates.english }}</strong>
      </div>
      <div class="global-calendar-row">
        <span class="global-calendar-label">বাংলা</span>
        <strong class="calendar-bn">{{ dates.bangla }}</strong>
      </div>
      <div class="global-calendar-row">
        <span class="global-calendar-label">হিজরি</span>
        <strong class="calendar-bn">{{ dates.hijri }}</strong>
      </div>
    </div>

    <button v-if="mobileOpen" class="global-calendar-dismiss" type="button" aria-label="Close calendar dates" @click="closeMobile"></button>
  </div>
</template>
