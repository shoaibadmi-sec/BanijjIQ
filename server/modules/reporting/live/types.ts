export type ReportStatus = 'ready' | 'needs-review' | 'incomplete' | 'unavailable';
export type LiveReportKey = 'sales' | 'purchase' | 'stock' | 'receivables' | 'payables' | 'profit' | 'product-profit' | 'profit-loss' | 'cash' | 'bank' | 'finance' | 'expenses' | 'audit';
export type LiveReportRange = { from: string; to: string };
export type LiveReportQuery = LiveReportRange & {
  report: LiveReportKey;
  page: number;
  pageSize: 50 | 100;
  search: string;
  sort: 'date' | 'amount' | 'name' | 'reference';
  direction: 'asc' | 'desc';
};
export type EvidenceSource = { module: string; sourceId: string; date: string | null };
export type ReportMetric = { key: string; valueMinor: number | null; status: ReportStatus; reason: string; asOf: string; sources: EvidenceSource[] };
export type LiveReportRow = {
  sourceId: string; sourceModule: string; date: string; label: string;
  amountMinor: number | null; paidMinor?: number | null; dueMinor?: number | null;
  status: ReportStatus; reason: string;
};
export type LiveReportPage = {
  ok: true; report: LiveReportKey; range: LiveReportRange; page: number; pageSize: 50 | 100;
  totalRows: number; rows: LiveReportRow[]; metrics: ReportMetric[];
  coverage: { status: ReportStatus; reason: string };
};
