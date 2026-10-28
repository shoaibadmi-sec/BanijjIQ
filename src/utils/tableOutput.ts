export type TableAlign = 'left' | 'center' | 'right';

export interface TableOutputColumn<Row> {
  label: string;
  key?: keyof Row | string;
  value?: (row: Row) => unknown;
  align?: TableAlign;
}

export interface TableOutputBusinessHeader {
  shopName?: string;
  shopNameBangla?: string;
  address?: string;
  phone1?: string;
  phone2?: string;
  email?: string;
  logoDataUri?: string;
}

export interface TableOutputOptions<Row> {
  title: string;
  subtitle?: string;
  businessHeader?: TableOutputBusinessHeader;
  contextLines?: string[];
  filename?: string;
  columns: TableOutputColumn<Row>[];
  rows: Row[];
  footerLines?: Array<{ label: string; value: unknown }>;
}

function resolveColumnValue<Row>(row: Row, column: TableOutputColumn<Row>): unknown {
  if (column.value) return column.value(row);
  if (!column.key) return '';
  return (row as unknown as Record<string, unknown>)[String(column.key)];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeFilename(filename: string, extension: string): string {
  const cleaned = String(filename || 'export')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'export';
  return cleaned.toLowerCase().endsWith(`.${extension}`) ? cleaned : `${cleaned}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, normalizeFilename(filename, 'json'));
}

export function exportRowsToCsv<Row>(options: Omit<TableOutputOptions<Row>, 'title'> & { title?: string }): void {
  const columns = options.columns || [];
  const lines = [columns.map(column => csvCell(column.label)).join(',')];
  for (const row of options.rows || []) {
    lines.push(columns.map(column => csvCell(resolveColumnValue(row, column))).join(','));
  }

  // UTF-8 BOM is intentional. It makes Bangla text and ৳ open correctly in Excel.
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, normalizeFilename(options.filename || options.title || 'export', 'csv'));
}

function buildPrintDocument<Row>(options: TableOutputOptions<Row>): string {
  const columns = options.columns || [];
  const business = options.businessHeader || {};
  const header = columns.map(column => `<th style="text-align:${column.align || 'left'}">${escapeHtml(column.label)}</th>`).join('');
  const body = (options.rows || []).map(row => {
    const cells = columns.map(column => {
      const value = resolveColumnValue(row, column);
      return `<td style="text-align:${column.align || 'left'}">${escapeHtml(value)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  const footer = (options.footerLines || []).map(line => (
    `<div class="footer-row"><span>${escapeHtml(line.label)}</span><strong>${escapeHtml(line.value)}</strong></div>`
  )).join('');
  const contact = [business.address, business.phone1, business.phone2, business.email].filter(Boolean).map(escapeHtml).join(' · ');
  const context = (options.contextLines || []).filter(Boolean).map(line => `<div>${escapeHtml(line)}</div>`).join('');
  const logo = business.logoDataUri ? `<img class="logo" src="${escapeHtml(business.logoDataUri)}" alt="" />` : '';
  const businessBlock = (business.shopName || business.shopNameBangla || contact || logo) ? `
    <div class="business">
      ${logo}
      <div class="business-text">
        ${business.shopName ? `<div class="shop-name">${escapeHtml(business.shopName)}</div>` : ''}
        ${business.shopNameBangla ? `<div class="shop-name-bn">${escapeHtml(business.shopNameBangla)}</div>` : ''}
        ${contact ? `<div class="contact">${contact}</div>` : ''}
      </div>
    </div>` : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title || 'SherERP')}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,"Noto Sans Bengali",sans-serif}
  body{padding:0;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .paper{width:100%;margin:0;padding:0}
  .business{display:flex;align-items:center;justify-content:center;gap:12px;text-align:center;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid #aaa}
  .logo{width:52px;height:52px;object-fit:contain;flex:0 0 auto}
  .business-text{min-width:0}.shop-name{font-size:18px;font-weight:800;line-height:1.2}.shop-name-bn{font-size:15px;font-weight:700;line-height:1.25;margin-top:2px}.contact{font-size:10px;color:#444;margin-top:3px}
  .heading{margin-bottom:12px}.heading h1{margin:0 0 4px;font-size:18px;line-height:1.25}.heading div{color:#444;font-size:11px;margin-top:2px}
  table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #bbb;padding:5px 6px;vertical-align:top;word-break:break-word}th{background:#f3f4f6;font-weight:700}tr{break-inside:avoid}.empty{text-align:center!important;padding:18px!important;color:#666}
  .footer{margin-top:12px;margin-left:auto;width:min(340px,100%)}.footer-row{display:flex;justify-content:space-between;gap:20px;padding:4px 0;border-bottom:1px solid #ddd}.footer-row strong{text-align:right}
  @page{margin:10mm}
  @media print{html,body{width:auto;height:auto;overflow:visible}.paper{width:100%}}
</style>
</head>
<body>
  <section class="paper">
    ${businessBlock}
    <header class="heading">
      <h1>${escapeHtml(options.title || 'SherERP')}</h1>
      ${options.subtitle ? `<div>${escapeHtml(options.subtitle)}</div>` : ''}
      ${context}
    </header>
    <table>
      <thead><tr>${header}</tr></thead>
      <tbody>${body || `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty">No rows to print.</td></tr>`}</tbody>
    </table>
    ${footer ? `<footer class="footer">${footer}</footer>` : ''}
  </section>
</body>
</html>`;
}

export function printRows<Row>(options: TableOutputOptions<Row>): void {
  // Print from an isolated iframe rather than temporarily hiding the ERP DOM.
  // This avoids blank previews in Chromium/Android where the parent page can be
  // snapshotted before dynamically injected print content is painted.
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  document.body.appendChild(frame);

  const printWindow = frame.contentWindow;
  const printDocument = frame.contentDocument;
  if (!printWindow || !printDocument) {
    frame.remove();
    return;
  }

  printDocument.open();
  printDocument.write(buildPrintDocument(options));
  printDocument.close();

  let cleaned = false;
  let fallbackTimer = 0;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    frame.remove();
  };

  printWindow.addEventListener('afterprint', cleanup, { once: true });
  fallbackTimer = window.setTimeout(cleanup, 60000);

  const startPrint = () => {
    if (cleaned) return;
    printWindow.focus();
    printWindow.print();
  };

  const images = Array.from(printDocument.images);
  const waitForImages = Promise.all(images.map(image => image.complete
    ? Promise.resolve()
    : new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      })));
  const fontsReady = printDocument.fonts?.ready || Promise.resolve();

  void Promise.all([waitForImages, fontsReady]).then(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(startPrint));
  });
}

