import { computed, reactive } from 'vue';

export type LedgerRecordLimit = 50 | 100 | 200;

export interface LedgerHistoryFilters {
  from: string;
  to: string;
  limit: LedgerRecordLimit;
}

function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useLedgerHistory(initial?: Partial<LedgerHistoryFilters>) {
  const filters = reactive<LedgerHistoryFilters>({
    from: initial?.from || '',
    to: initial?.to || localTodayIso(),
    limit: initial?.limit || 50
  });

  const limits: LedgerRecordLimit[] = [50, 100, 200];
  const rangeLabel = computed(() => filters.from ? `${filters.from} → ${filters.to}` : `Up to ${filters.to}`);

  function params() {
    return { from: filters.from, to: filters.to, limit: filters.limit };
  }

  function reset() {
    filters.from = '';
    filters.to = localTodayIso();
    filters.limit = 50;
  }

  return { filters, limits, rangeLabel, params, reset };
}
