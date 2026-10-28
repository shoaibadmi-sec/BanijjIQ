import { reactive } from 'vue';

export type TableSortDirection = 'asc' | 'desc';
export type TableSortType = 'text' | 'number' | 'date';

export interface TableSortState {
  column: string;
  direction: TableSortDirection;
  type: TableSortType;
}

const sortStates = reactive<Record<string, TableSortState>>({});
const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function readPath(row: unknown, path: string): unknown {
  if (!row || !path) return undefined;
  return path.split('.').reduce<unknown>((value, key) => {
    if (value == null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, row);
}

function getPathValue(row: unknown, path: string): unknown {
  if (path.startsWith('@abs:')) {
    const value = numberValue(readPath(row, path.slice(5)));
    return value == null ? null : Math.abs(value);
  }
  if (path.startsWith('@len:')) {
    const value = readPath(row, path.slice(5));
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    return value == null ? null : String(value).length;
  }
  if (path.startsWith('@diff:')) {
    const [leftPath, rightPath] = path.slice(6).split(',');
    const left = numberValue(readPath(row, leftPath || ''));
    const right = numberValue(readPath(row, rightPath || ''));
    return left == null || right == null ? null : left - right;
  }
  if (path.startsWith('@mul:')) {
    const [leftPath, rightPath] = path.slice(5).split(',');
    const left = numberValue(readPath(row, leftPath || ''));
    const right = numberValue(readPath(row, rightPath || ''));
    return left == null || right == null ? null : left * right;
  }
  return readPath(row, path);
}

function numberValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9+-.]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](.*))?$/.exec(text);
  if (iso) {
    const [, year, month, day, rest] = iso;
    const parsed = Date.parse(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${rest ? `T${rest}` : 'T00:00:00'}`);
    if (Number.isFinite(parsed)) return parsed;
  }

  const dmy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(.*))?$/.exec(text);
  if (dmy) {
    const [, day, month, year, rest] = dmy;
    const parsed = Date.parse(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${rest ? `T${rest}` : 'T00:00:00'}`);
    if (Number.isFinite(parsed)) return parsed;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareValues(a: unknown, b: unknown, type: TableSortType): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (type === 'number') {
    const av = numberValue(a);
    const bv = numberValue(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  }

  if (type === 'date') {
    const av = dateValue(a);
    const bv = dateValue(b);
    if (av == null && bv == null) return textCollator.compare(String(a), String(b));
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  }

  return textCollator.compare(String(a), String(b));
}

export function getTableSortState(tableId: string): TableSortState | undefined {
  return sortStates[tableId];
}

export function ensureTableSort(
  tableId: string,
  column: string,
  direction: TableSortDirection = 'asc',
  type: TableSortType = 'text'
): TableSortState {
  if (!sortStates[tableId]) sortStates[tableId] = { column, direction, type };
  return sortStates[tableId];
}

export function setTableSort(
  tableId: string,
  column: string,
  direction: TableSortDirection = 'asc',
  type: TableSortType = 'text'
): void {
  sortStates[tableId] = { column, direction, type };
}

export function toggleTableSort(tableId: string, column: string, type: TableSortType = 'text'): void {
  const current = sortStates[tableId];
  if (current?.column === column) {
    sortStates[tableId] = {
      column,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
      type
    };
    return;
  }
  sortStates[tableId] = { column, direction: 'asc', type };
}

export function sortRows<T>(tableId: string, rows: readonly T[] | null | undefined): T[] {
  const source = rows ? Array.from(rows) : [];
  const state = sortStates[tableId];
  if (!state || source.length < 2) return source;

  return source
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const comparison = compareValues(
        getPathValue(left.row, state.column),
        getPathValue(right.row, state.column),
        state.type
      );
      const directed = state.direction === 'asc' ? comparison : -comparison;
      return directed || left.index - right.index;
    })
    .map(({ row }) => row);
}
