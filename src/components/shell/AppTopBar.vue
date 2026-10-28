<script setup lang="ts">
import GlobalCalendarDates from './GlobalCalendarDates.vue';
import GlobalCalculator from './GlobalCalculator.vue';
defineProps<{
  title: string;
  hint: string;
  userName: string;
  userRole: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  toggleNavigation: [];
  logout: [];
  refresh: [];
}>();
</script>

<template>
  <header class="topbar">
    <button class="icon-btn menu-toggle" title="Collapse / expand navigation" type="button" aria-label="Toggle navigation" @click="emit('toggleNavigation')">☰</button>

    <div class="topbar-heading">
      <div class="topbar-title">{{ title }}</div>
      <span class="bn-hint">{{ hint }}</span>
    </div>

    <slot name="search" />
    <GlobalCalendarDates />
    <slot name="tools" />

    <GlobalCalculator />

    <div class="user-chip">
      <strong>{{ userName }}</strong>
      <span>{{ userRole }}</span>
    </div>
    <button class="btn" type="button" @click="emit('logout')">Logout</button>
    <button class="btn btn-primary topbar-refresh" id="refreshBtn" type="button" :class="{ spinning: loading }" :disabled="loading" title="Refresh this page" @click="emit('refresh')">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20 11a8 8 0 1 0-.6 3M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>{{ loading ? 'Refreshing...' : 'Refresh' }}</span>
    </button>
  </header>
</template>
