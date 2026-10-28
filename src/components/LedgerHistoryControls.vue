<script setup lang="ts">
import type { LedgerRecordLimit } from '../composables/useLedgerHistory';

const props = withDefaults(defineProps<{
  from: string;
  to: string;
  limit: LedgerRecordLimit;
  matchingCount?: number;
  returnedCount?: number;
  hasMore?: boolean;
  loading?: boolean;
}>(), {
  matchingCount: 0,
  returnedCount: 0,
  hasMore: false,
  loading: false
});

const emit = defineEmits<{
  (e: 'update:from', value: string): void;
  (e: 'update:to', value: string): void;
  (e: 'update:limit', value: LedgerRecordLimit): void;
  (e: 'refresh'): void;
}>();

function updateFrom(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit('update:from', value);
  if (value && props.to && value > props.to) emit('update:to', value);
}

function updateTo(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit('update:to', value);
  if (value && props.from && value < props.from) emit('update:from', value);
}

function updateLimit(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  emit('update:limit', (value === 100 || value === 200 ? value : 50) as LedgerRecordLimit);
}
</script>

<template>
  <div class="ledger-history-controls">
    <div class="ledger-history-field">
      <label>From Date</label>
      <input :value="from" type="date" @change="updateFrom" />
    </div>
    <div class="ledger-history-field">
      <label>To Date</label>
      <input :value="to" type="date" @change="updateTo" />
    </div>
    <div class="ledger-history-field ledger-limit-field">
      <label>Records</label>
      <select :value="limit" @change="updateLimit">
        <option :value="50">50</option>
        <option :value="100">100</option>
        <option :value="200">200</option>
      </select>
    </div>
    <button class="btn" type="button" :disabled="loading" @click="emit('refresh')">{{ loading ? 'Loading...' : 'Apply' }}</button>
    <div class="ledger-history-count" aria-live="polite">
      Showing {{ returnedCount }} of {{ matchingCount }}{{ hasMore ? ' matching records' : ' records' }}
    </div>
  </div>
</template>
