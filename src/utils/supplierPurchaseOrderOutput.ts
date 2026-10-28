import type { SupplierPurchaseOrder } from '../types';
import { downloadBlob } from './tableOutput';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFilename(value: string): string {
  return String(value || 'supplier-purchase-order').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
}

export function supplierPurchaseOrderHtml(order: SupplierPurchaseOrder): string {
  const phones = [order.shop.phone1, order.shop.phone2].filter(Boolean).join(' / ');
  const rows = order.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.productName)}</td>
      <td class="qty">${Math.max(0, Math.round(Number(item.quantity || 0)))}</td>
    </tr>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(order.orderNo)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,'Noto Sans Bengali',sans-serif;color:#111;margin:0;background:#fff}.paper{max-width:800px;margin:0 auto}.head{text-align:center;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:18px}.logo{max-height:64px;max-width:120px;margin-bottom:6px}.shop{font-size:24px;font-weight:800}.shop-bn{font-size:18px;font-weight:700;margin-top:2px}.muted{font-size:12px;color:#333;margin-top:3px}.title{text-align:center;font-size:18px;font-weight:800;letter-spacing:.08em;margin:16px 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:16px;font-size:13px}.supplier{border:1px solid #bbb;padding:10px 12px;margin-bottom:16px;font-size:14px}.supplier strong{font-size:15px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #777;padding:8px}th{background:#f3f3f3;text-align:left}.qty{text-align:right;width:90px;font-weight:700}
</style></head><body><section class="paper">
<header class="head">${order.shop.logo ? `<img class="logo" src="${escapeHtml(order.shop.logo)}">` : ''}<div class="shop">${escapeHtml(order.shop.shopName || 'SherERP')}</div>${order.shop.shopNameBangla ? `<div class="shop-bn">${escapeHtml(order.shop.shopNameBangla)}</div>` : ''}${order.shop.description ? `<div class="muted">${escapeHtml(order.shop.description)}</div>` : ''}${order.shop.address ? `<div class="muted">${escapeHtml(order.shop.address)}</div>` : ''}${phones ? `<div class="muted">${escapeHtml(phones)}</div>` : ''}${order.shop.email ? `<div class="muted">${escapeHtml(order.shop.email)}</div>` : ''}</header>
<div class="title">PURCHASE ORDER</div>
<div class="meta"><div><strong>Order No:</strong> ${escapeHtml(order.orderNo)}</div><div><strong>Date:</strong> ${escapeHtml(order.orderDate)}</div></div>
<div class="supplier"><span>Supplier</span><br><strong>${escapeHtml(order.supplierName)}</strong></div>
<table><thead><tr><th>Product Name</th><th class="qty">Quantity</th></tr></thead><tbody>${rows || '<tr><td colspan="2">No products</td></tr>'}</tbody></table>
</section></body></html>`;
}

export function printSupplierPurchaseOrder(order: SupplierPurchaseOrder): void {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Pop-up blocked. Allow pop-ups to print the supplier purchase order.');
  try { win.opener = null; } catch {}
  win.document.open();
  win.document.write(supplierPurchaseOrderHtml(order));
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 250);
}

export function saveSupplierPurchaseOrderPdf(order: SupplierPurchaseOrder): void {
  // Browser print is the most reliable dependency-free PDF path across Chrome,
  // Android and Cloudflare-hosted PWAs. The user chooses “Save as PDF”.
  printSupplierPurchaseOrder(order);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) current = next;
    else { lines.push(current); current = words[i]; }
  }
  lines.push(current);
  return lines;
}

export async function supplierPurchaseOrderPng(order: SupplierPurchaseOrder): Promise<Blob> {
  const width = 1080;
  const rowHeight = 54;
  const baseHeight = 520 + Math.max(1, order.items.length) * rowHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(900, baseHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image output is not supported in this browser.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111'; ctx.textBaseline = 'top';

  let y = 55;
  const logo = await loadImage(order.shop.logo);
  if (logo) {
    const maxW = 150, maxH = 80;
    const ratio = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const w = logo.width * ratio, h = logo.height * ratio;
    ctx.drawImage(logo, (width - w) / 2, y, w, h);
    y += h + 12;
  }

  ctx.textAlign = 'center';
  ctx.font = '700 38px Arial'; ctx.fillText(order.shop.shopName || 'SherERP', width / 2, y); y += 50;
  if (order.shop.shopNameBangla) { ctx.font = '700 28px Arial'; ctx.fillText(order.shop.shopNameBangla, width / 2, y); y += 38; }
  ctx.font = '22px Arial';
  for (const line of [order.shop.description, order.shop.address, [order.shop.phone1, order.shop.phone2].filter(Boolean).join(' / '), order.shop.email].filter(Boolean)) {
    ctx.fillText(line, width / 2, y); y += 30;
  }
  y += 10; ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(70, y); ctx.lineTo(width - 70, y); ctx.stroke(); y += 30;
  ctx.font = '800 30px Arial'; ctx.fillText('PURCHASE ORDER', width / 2, y); y += 55;

  ctx.textAlign = 'left'; ctx.font = '22px Arial';
  ctx.fillText(`Order No: ${order.orderNo}`, 80, y);
  ctx.textAlign = 'right'; ctx.fillText(`Date: ${order.orderDate}`, width - 80, y); y += 45;
  ctx.textAlign = 'left'; ctx.font = '20px Arial'; ctx.fillText('Supplier', 80, y); y += 28;
  ctx.font = '700 26px Arial'; ctx.fillText(order.supplierName, 80, y); y += 48;

  const left = 70, right = width - 70, qtyX = right - 170;
  ctx.fillStyle = '#f1f1f1'; ctx.fillRect(left, y, right - left, rowHeight);
  ctx.fillStyle = '#111'; ctx.strokeStyle = '#777'; ctx.strokeRect(left, y, right - left, rowHeight);
  ctx.beginPath(); ctx.moveTo(qtyX, y); ctx.lineTo(qtyX, y + rowHeight); ctx.stroke();
  ctx.font = '700 21px Arial'; ctx.textAlign = 'left'; ctx.fillText('Product Name', left + 16, y + 15); ctx.textAlign = 'right'; ctx.fillText('Quantity', right - 16, y + 15); y += rowHeight;

  ctx.font = '20px Arial';
  for (const item of order.items) {
    ctx.strokeStyle = '#999'; ctx.strokeRect(left, y, right - left, rowHeight);
    ctx.beginPath(); ctx.moveTo(qtyX, y); ctx.lineTo(qtyX, y + rowHeight); ctx.stroke();
    ctx.textAlign = 'left';
    const nameLines = wrapLines(ctx, item.productName, qtyX - left - 34);
    ctx.fillText(nameLines[0], left + 16, y + 15);
    ctx.textAlign = 'right'; ctx.font = '700 20px Arial'; ctx.fillText(String(Math.round(Number(item.quantity || 0))), right - 16, y + 15); ctx.font = '20px Arial';
    y += rowHeight;
  }

  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not generate PNG image.')), 'image/png', 0.95));
}

export async function downloadSupplierPurchaseOrderImage(order: SupplierPurchaseOrder): Promise<void> {
  const blob = await supplierPurchaseOrderPng(order);
  downloadBlob(blob, `${safeFilename(order.orderNo)}.png`);
}

export async function shareSupplierPurchaseOrderImage(order: SupplierPurchaseOrder): Promise<'shared' | 'downloaded'> {
  const blob = await supplierPurchaseOrderPng(order);
  const file = new File([blob], `${safeFilename(order.orderNo)}.png`, { type: 'image/png' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title: order.orderNo, text: `Purchase Order ${order.orderNo} - ${order.supplierName}`, files: [file] });
    return 'shared';
  }
  downloadBlob(blob, file.name);
  return 'downloaded';
}
