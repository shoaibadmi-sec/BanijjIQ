<script setup lang="ts">
import { computed } from 'vue';
import type { ShellNavItem } from './types';

const props = defineProps<{
  items: ShellNavItem[];
  activeKey: string;
  open: boolean;
  compact?: boolean;
  footerText?: string;
}>();

const emit = defineEmits<{
  select: [key: string];
  toggle: [];
}>();

interface NavGroupDefinition {
  key: string;
  label: string;
  itemKeys: string[];
}

const groupDefinitions: NavGroupDefinition[] = [
  { key: 'main', label: 'MAIN', itemKeys: ['dashboard', 'pos'] },
  { key: 'sales', label: 'SALES', itemKeys: ['sales', 'customers'] },
  { key: 'products-stock', label: 'PRODUCTS & STOCK', itemKeys: ['products', 'tracking'] },
  { key: 'purchasing', label: 'PURCHASING', itemKeys: ['purchase', 'suppliers', 'vendors'] },
  { key: 'finance', label: 'FINANCE', itemKeys: ['expense', 'bank', 'finance', 'daybook'] },
  { key: 'reports', label: 'REPORTS', itemKeys: ['reports'] },
  { key: 'system', label: 'SYSTEM', itemKeys: ['settings'] },
];

const visibleGroups = computed(() => {
  const byKey = new Map(props.items.map((item) => [item.key, item]));
  const groupedKeys = new Set<string>();

  const groups = groupDefinitions
    .map((group) => {
      const items = group.itemKeys
        .map((key) => byKey.get(key))
        .filter((item): item is ShellNavItem => Boolean(item));

      items.forEach((item) => groupedKeys.add(item.key));
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);

  // Keep future/permission-driven modules visible even if they are not yet
  // assigned to a business group.
  const ungrouped = props.items.filter((item) => !groupedKeys.has(item.key));
  if (ungrouped.length > 0) {
    groups.push({
      key: 'other',
      label: 'OTHER',
      itemKeys: [],
      items: ungrouped,
    });
  }

  return groups;
});
</script>

<template>
  <aside class="sidebar" :class="{ open, compact }">
    <div class="sidebar-header">
      <div class="logo-mark">SE</div>
      <div class="shop-name">SherERP<br><span class="bn-hint">ব্যবসা ব্যবস্থাপনা</span></div>
      <button
        type="button"
        class="sidebar-collapse-toggle"
        :aria-label="compact ? 'Expand sidebar' : 'Collapse sidebar'"
        :title="compact ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="emit('toggle')"
      >{{ compact ? '›' : '‹' }}</button>
    </div>

    <nav class="nav-list shell-nav-groups" aria-label="Main navigation">
      <section
        v-for="group in visibleGroups"
        :key="group.key"
        class="shell-nav-group"
        :aria-label="group.label"
      >
        <div class="shell-nav-group-label">{{ group.label }}</div>

        <button
          v-for="item in group.items"
          :key="item.key"
          type="button"
          class="nav-item shell-nav-button"
          :class="{ active: activeKey === item.key }"
          :aria-current="activeKey === item.key ? 'page' : undefined"
          :aria-label="compact ? `${item.label} — ${item.hint}` : undefined"
          :title="compact ? `${item.label} — ${item.hint}` : undefined"
          @click="emit('select', item.key)"
        >
          <span class="shell-nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="nav-item-text">
            {{ item.label }}
            <span class="bn-hint">{{ item.hint }}</span>
          </span>
        </button>
      </section>
    </nav>

    <div class="sidebar-footer">{{ footerText || 'SherERP' }}</div>
  </aside>
</template>
