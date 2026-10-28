<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppSidebar from './AppSidebar.vue';
import AppBottomNav from './AppBottomNav.vue';
import AppTopBar from './AppTopBar.vue';
import GlobalHorizontalScroll from './GlobalHorizontalScroll.vue';
import type { ShellNavItem } from './types';

const props = defineProps<{
  navItems: ShellNavItem[];
  activeModule: string;
  sidebarOpen: boolean;
  moduleTitle: string;
  moduleHint: string;
  userName: string;
  userRole: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:sidebarOpen': [open: boolean];
  selectModule: [key: string];
  logout: [];
  refresh: [];
}>();

const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth);
const compactPreference = ref(typeof localStorage !== 'undefined' ? localStorage.getItem('shererp-sidebar-compact') === '1' : false);
const narrowExpanded = ref(false);
const isMobile = computed(() => viewportWidth.value <= 860);
const isNarrowDesktop = computed(() => viewportWidth.value > 860 && viewportWidth.value <= 1180);
const sidebarCompact = computed(() => isMobile.value ? false : (isNarrowDesktop.value ? !narrowExpanded.value : compactPreference.value));

function onResize() {
  const wasNarrow = isNarrowDesktop.value;
  viewportWidth.value = window.innerWidth;
  if (!wasNarrow && isNarrowDesktop.value) narrowExpanded.value = false;
  if (!isNarrowDesktop.value) narrowExpanded.value = false;
  if (!isMobile.value && props.sidebarOpen) emit('update:sidebarOpen', false);
}
function toggleNavigation(): void {
  if (isMobile.value) {
    emit('update:sidebarOpen', !props.sidebarOpen);
    return;
  }
  if (isNarrowDesktop.value) {
    narrowExpanded.value = !narrowExpanded.value;
    return;
  }
  compactPreference.value = !compactPreference.value;
  try { localStorage.setItem('shererp-sidebar-compact', compactPreference.value ? '1' : '0'); } catch { /* ignore storage restrictions */ }
}
function selectModule(key: string): void {
  emit('selectModule', key);
  if (isMobile.value) emit('update:sidebarOpen', false);
}

onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));
</script>

<template>
  <AppSidebar
    :items="props.navItems"
    :active-key="props.activeModule"
    :open="props.sidebarOpen"
    :compact="sidebarCompact"
    :footer-text="props.userName"
    :footer-hint="props.userRole"
    @select="selectModule"
    @toggle="toggleNavigation"
  />

  <div v-if="props.sidebarOpen && isMobile" class="sidebar-scrim" @click="emit('update:sidebarOpen', false)"></div>

  <main class="main" :class="{ 'sidebar-compact': sidebarCompact }">
    <AppTopBar
      :title="props.moduleTitle"
      :hint="props.moduleHint"
      :user-name="props.userName"
      :user-role="props.userRole"
      :loading="props.loading"
      @toggle-navigation="toggleNavigation"
      @logout="emit('logout')"
      @refresh="emit('refresh')"
    >
      <template #tools>
        <slot name="topbar-tools" />
      </template>
    </AppTopBar>

    <section class="content">
      <slot />
    </section>

    <GlobalHorizontalScroll />
  </main>
  <AppBottomNav :items="props.navItems" :active-key="props.activeModule" @select="selectModule" @more="emit('update:sidebarOpen', true)" />
</template>
