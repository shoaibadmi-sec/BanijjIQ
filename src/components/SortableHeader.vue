<script setup lang="ts">
import { computed } from 'vue';
import { getTableSortState, toggleTableSort, type TableSortType } from '../utils/tableSorting';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  tableId: string;
  column: string;
  type?: TableSortType;
}>(), {
  type: 'text'
});

const state = computed(() => getTableSortState(props.tableId));
const active = computed(() => state.value?.column === props.column);
const direction = computed(() => active.value ? state.value?.direction : undefined);
const ariaSort = computed(() => !active.value ? 'none' : direction.value === 'asc' ? 'ascending' : 'descending');

function activate(): void {
  toggleTableSort(props.tableId, props.column, props.type);
}
</script>

<template>
  <th
    v-bind="$attrs"
    class="sortable-column-header"
    :class="{ 'is-sorted': active }"
    :aria-sort="ariaSort"
    tabindex="0"
    role="columnheader"
    @click="activate"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent="activate"
  >
    <span class="sortable-header-content"><slot /></span>
    <span class="sort-indicator" aria-hidden="true">
      <span v-if="!active" class="sort-idle">↕</span>
      <span v-else-if="direction === 'asc'">▲</span>
      <span v-else>▼</span>
    </span>
  </th>
</template>
