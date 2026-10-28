import type { SherDatabase } from '../db/types.js';

export type LedgerRecordLimit = 50 | 100 | 200;

export interface LedgerHistoryQuery {
  from: string;
  to: string;
  limit: LedgerRecordLimit;
}

export interface LedgerPrintHeader {
  shopName: string;
  shopNameBangla: string;
  address: string;
  phone1: string;
  phone2: string;
  email: string;
  logoDataUri: string;
}

const ALLOWED_LIMITS = new Set<number>([50, 100, 200]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cleanDate(value: string | null): string {
  const text = String(value ?? '').trim();
  return ISO_DATE.test(text) ? text : '';
}

export function parseLedgerHistory(url: URL, names: { from?: string; to?: string } = {}): LedgerHistoryQuery {
  const fromKey = names.from || 'from';
  const toKey = names.to || 'to';
  let from = cleanDate(url.searchParams.get(fromKey));
  let to = cleanDate(url.searchParams.get(toKey)) || todayIso();
  if (from && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const rawLimit = Number(url.searchParams.get('limit') || 50);
  const limit = (ALLOWED_LIMITS.has(rawLimit) ? rawLimit : 50) as LedgerRecordLimit;
  return { from, to, limit };
}

export function ledgerDateWhere(column: string, query: LedgerHistoryQuery): { sql: string; values: string[] } {
  const parts = [`${column} <= ?`];
  const values = [query.to];
  if (query.from) {
    parts.unshift(`${column} >= ?`);
    values.unshift(query.from);
  }
  return { sql: parts.join(' AND '), values };
}

export async function getLedgerPrintHeader(db: SherDatabase): Promise<LedgerPrintHeader> {
  const keys = ['Shop Name', 'Shop Name Bangla', 'Address', 'Phone 1', 'Phone 2', 'Email', 'Invoice Logo'];
  const placeholders = keys.map(() => '?').join(',');
  const result = await db.prepare(`SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${placeholders})`).bind(...keys).all<{ setting_key: string; setting_value: string }>();
  const map = new Map<string, string>();
  for (const row of result.results || []) map.set(String(row.setting_key), String(row.setting_value || ''));
  return {
    shopName: map.get('Shop Name') || 'SherERP',
    shopNameBangla: map.get('Shop Name Bangla') || '',
    address: map.get('Address') || '',
    phone1: map.get('Phone 1') || '',
    phone2: map.get('Phone 2') || '',
    email: map.get('Email') || '',
    logoDataUri: map.get('Invoice Logo') || ''
  };
}

export function ledgerHistoryMeta(query: LedgerHistoryQuery, matchingCount: number, returnedCount: number) {
  return {
    from: query.from,
    to: query.to,
    limit: query.limit,
    matchingCount,
    returnedCount,
    hasMore: matchingCount > returnedCount
  };
}
