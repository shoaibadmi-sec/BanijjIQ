function copyComputedStyles(source: Element, target: Element) {
  const style = getComputedStyle(source as HTMLElement);
  let css = '';
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    css += `${prop}:${style.getPropertyValue(prop)};`;
  }
  (target as HTMLElement).setAttribute('style', css);
  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    if (targetChildren[index]) copyComputedStyles(child, targetChildren[index]);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read invoice image.'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load invoice image.'));
    img.src = src;
  });
}

async function rasterizeImage(src: string): Promise<string | null> {
  if (!src) return null;

  // Common raster data URLs are already self-contained and cannot taint the
  // export canvas, so keep them as-is.
  if (/^data:image\/(?:png|jpe?g|webp|gif);/i.test(src)) return src;

  let objectUrl = '';
  try {
    let blob: Blob;
    if (src.startsWith('data:')) {
      blob = await (await fetch(src)).blob();
    } else {
      const absolute = new URL(src, window.location.href);
      const response = await fetch(absolute.href, {
        mode: 'cors',
        credentials: absolute.origin === window.location.origin ? 'same-origin' : 'omit',
      });
      if (!response.ok) return null;
      blob = await response.blob();
    }

    // Rasterize SVG/remote images into a plain PNG data URL. This removes any
    // nested/external image references that would otherwise taint the canvas.
    objectUrl = URL.createObjectURL(blob);
    const img = await loadImage(objectUrl);
    const width = Math.max(1, img.naturalWidth || img.width || 1);
    const height = Math.max(1, img.naturalHeight || img.height || 1);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function scrubUnsafeStyles(root: HTMLElement, forceSystemFonts = false) {
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  for (const node of nodes) {
    // Computed styles can contain URL-backed resources besides background-image
    // (cursor, border-image, list-style-image, masks, filters, etc.). Any one of
    // those can taint the SVG foreignObject canvas. Remove every non-data URL.
    for (let i = node.style.length - 1; i >= 0; i--) {
      const prop = node.style[i];
      const value = node.style.getPropertyValue(prop);
      if (/url\(/i.test(value) && !/data:image\/(?:png|jpe?g|webp|gif);/i.test(value)) {
        node.style.removeProperty(prop);
      }
    }

    // Some Chromium builds treat externally loaded webfonts inside a
    // foreignObject as a cross-origin resource even when there are no images.
    // The final fallback uses only local/system fonts, while still allowing the
    // browser to choose its installed Bengali/Arabic glyph fallback.
    if (forceSystemFonts) {
      node.style.setProperty('font-family', 'Arial, sans-serif', 'important');
      node.style.removeProperty('font-feature-settings');
      node.style.removeProperty('font-variation-settings');
    }
  }
}

async function prepareCloneImages(source: HTMLElement, clone: HTMLElement, omitAllImages: boolean): Promise<number> {
  const sourceImages = Array.from(source.querySelectorAll<HTMLImageElement>('img'));
  const cloneImages = Array.from(clone.querySelectorAll<HTMLImageElement>('img'));
  let omitted = 0;

  for (let i = 0; i < cloneImages.length; i++) {
    const cloneImg = cloneImages[i];
    const sourceImg = sourceImages[i];
    cloneImg.removeAttribute('srcset');
    cloneImg.removeAttribute('crossorigin');

    if (omitAllImages) {
      cloneImg.remove();
      omitted++;
      continue;
    }

    const src = sourceImg?.currentSrc || sourceImg?.src || cloneImg.src;
    const safeSrc = await rasterizeImage(src);
    if (safeSrc) {
      cloneImg.src = safeSrc;
    } else {
      cloneImg.remove();
      omitted++;
    }
  }

  return omitted;
}

async function renderElementToJpgBlob(
  element: HTMLElement,
  targetWidth: number,
  omitAllImages: boolean,
  forceSystemFonts = false,
): Promise<{ blob: Blob; omittedImages: number }> {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error('Invoice is not visible.');

  const clone = element.cloneNode(true) as HTMLElement;
  copyComputedStyles(element, clone);
  clone.style.margin = '0';
  clone.style.transform = 'none';
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.maxWidth = 'none';
  clone.style.boxShadow = 'none';

  const omittedImages = await prepareCloneImages(element, clone, omitAllImages);
  scrubUnsafeStyles(clone, forceSystemFonts);

  const serialized = new XMLSerializer().serializeToString(clone);
  const scale = targetWidth / rect.width;
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${rect.width} ${rect.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div></foreignObject></svg>`;
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image export is not supported in this browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(
          b => b ? resolve(b) : reject(new Error('Could not encode invoice JPG.')),
          'image/jpeg',
          0.94,
        );
      } catch (error) {
        reject(error);
      }
    });
    return { blob, omittedImages };
  } finally {
    URL.revokeObjectURL(url);
  }
}


async function renderElementToSafeCanvasJpgBlob(
  element: HTMLElement,
  targetWidth: number,
): Promise<{ blob: Blob; omittedImages: number }> {
  const rootRect = element.getBoundingClientRect();
  if (!rootRect.width || !rootRect.height) throw new Error('Invoice is not visible.');

  const scale = targetWidth / rootRect.width;
  const width = Math.max(1, Math.round(rootRect.width * scale));
  const height = Math.max(1, Math.round(rootRect.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is not supported in this browser.');

  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rootRect.width, rootRect.height);

  const nodes = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))];

  // Paint only browser-computed solid backgrounds and borders. This fallback
  // intentionally ignores images, shadows, gradients and URL-backed resources
  // so the canvas can never become cross-origin tainted.
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const x = rect.left - rootRect.left;
    const y = rect.top - rootRect.top;

    const bg = style.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, rect.width, rect.height);
    }

    const borders: Array<[string, string, number, number, number, number]> = [
      [style.borderTopStyle, style.borderTopColor, parseFloat(style.borderTopWidth) || 0, x, y, x + rect.width],
      [style.borderBottomStyle, style.borderBottomColor, parseFloat(style.borderBottomWidth) || 0, x, y + rect.height, x + rect.width],
    ];
    for (const [borderStyle, color, lineWidth, x1, y1, x2] of borders) {
      if (borderStyle !== 'none' && lineWidth > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y1);
        ctx.stroke();
      }
    }

    const leftWidth = parseFloat(style.borderLeftWidth) || 0;
    if (style.borderLeftStyle !== 'none' && leftWidth > 0) {
      ctx.strokeStyle = style.borderLeftColor;
      ctx.lineWidth = leftWidth;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + rect.height);
      ctx.stroke();
    }

    const rightWidth = parseFloat(style.borderRightWidth) || 0;
    if (style.borderRightStyle !== 'none' && rightWidth > 0) {
      ctx.strokeStyle = style.borderRightColor;
      ctx.lineWidth = rightWidth;
      ctx.beginPath();
      ctx.moveTo(x + rect.width, y);
      ctx.lineTo(x + rect.width, y + rect.height);
      ctx.stroke();
    }
  }

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const parent = textNode.parentElement;
    const value = textNode.nodeValue || '';
    if (parent && value.trim()) {
      const style = getComputedStyle(parent);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const fontSize = parseFloat(style.fontSize) || 12;
        const weight = style.fontWeight || '400';
        const fontStyle = style.fontStyle || 'normal';
        // Use local/system fonts only. Browser glyph fallback still handles
        // Bengali/Arabic text without loading any cross-origin font resource.
        ctx.font = `${fontStyle} ${weight} ${fontSize}px Arial, sans-serif`;
        ctx.fillStyle = style.color || '#111';
        ctx.textBaseline = 'alphabetic';
        ctx.direction = style.direction === 'rtl' ? 'rtl' : 'ltr';

        for (const match of value.matchAll(/\S+/g)) {
          if (match.index == null) continue;
          const range = document.createRange();
          range.setStart(textNode, match.index);
          range.setEnd(textNode, match.index + match[0].length);
          const rects = Array.from(range.getClientRects());
          range.detach();
          for (const rect of rects) {
            if (!rect.width || !rect.height) continue;
            const x = rect.left - rootRect.left;
            const y = rect.top - rootRect.top + (rect.height + fontSize) / 2 - 1;
            ctx.fillText(match[0], x, y);
          }
        }
      }
    }
    textNode = walker.nextNode();
  }

  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Could not encode invoice JPG.')),
      'image/jpeg',
      0.94,
    );
  });

  return {
    blob,
    omittedImages: element.querySelectorAll('img').length,
  };
}

export async function downloadElementAsJpg(
  element: HTMLElement,
  filename: string,
  targetWidth = 1600,
): Promise<{ omittedImages: number }> {
  let rendered: { blob: Blob; omittedImages: number } | null = null;
  let lastError: unknown = null;

  // Stage 1: preserve the complete invoice, including any safe logo.
  try {
    rendered = await renderElementToJpgBlob(element, targetWidth, false, false);
  } catch (error) {
    lastError = error;
  }

  // Stage 2: if Chromium reports a tainted canvas, remove all images.
  if (!rendered) {
    try {
      rendered = await renderElementToJpgBlob(element, targetWidth, true, false);
    } catch (error) {
      lastError = error;
    }
  }

  // Stage 3: genuinely canvas-safe fallback. Unlike the first two stages,
  // this does not use SVG foreignObject at all. It paints the invoice's solid
  // boxes, borders and positioned text directly onto a fresh canvas and omits
  // images. That guarantees Chromium cannot carry cross-origin taint into
  // canvas.toBlob().
  if (!rendered) {
    try {
      rendered = await renderElementToSafeCanvasJpgBlob(element, targetWidth);
    } catch (error) {
      lastError = error;
    }
  }

  if (!rendered) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError || 'Unknown browser export error');
    throw new Error(`Could not create invoice JPG: ${detail}`);
  }

  const href = URL.createObjectURL(rendered.blob);
  try {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(href), 1500);
  }

  return { omittedImages: rendered.omittedImages };
}

export async function printInvoiceElement(
  source: HTMLElement,
  mode: 'a4' | 'thermal' = 'a4',
  receiptSize: string = '80mm',
): Promise<void> {
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

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error('Print preview is not available in this browser.');
  }

  const styleNodes = Array.from(document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style,link[rel="stylesheet"]'));
  const copiedStyles = styleNodes.map(node => node.outerHTML).join('\n');
  const thermalWidthMm = receiptSize === '58mm' ? 58 : 80;
  const thermalWidth = `${thermalWidthMm}mm`;
  const pageRule = mode === 'thermal'
    ? `@page{size:${thermalWidth} 1000mm;margin:0;}`
    : '@page{size:A4 portrait;margin:8mm;}';
  const modeCss = mode === 'thermal'
    ? `html,body{width:${thermalWidth};max-width:${thermalWidth};}.invoice-paper{width:${thermalWidth}!important;max-width:${thermalWidth}!important;margin:0!important;}.invoice-page{min-height:0!important;height:auto!important;margin:0!important;break-inside:auto!important;page-break-inside:auto!important;}`
    : `.invoice-paper{width:100%!important;max-width:none!important;margin:0!important;}.invoice-page{width:100%!important;max-width:194mm!important;min-height:0!important;height:auto!important;margin:0 auto!important;break-inside:auto!important;page-break-inside:auto!important;}`;
  const overrideCss = `
    html,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;overflow:visible!important;background:#fff!important;}
    body,body *{visibility:visible!important;}
    .invoice-paper{box-shadow:none!important;background:#fff!important;overflow:visible!important;}
    .invoice-page{box-shadow:none!important;background:#fff!important;}
    .inv-signatures,.inv-footer-block,.inv-totals{break-inside:avoid!important;page-break-inside:avoid!important;}
    ${modeCss}
    @media print{
      html,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;overflow:visible!important;background:#fff!important;}
      body,body *{visibility:visible!important;}
      .invoice-paper,.invoice-page{box-shadow:none!important;overflow:visible!important;}
      ${modeCss}
      ${pageRule}
    }
    ${pageRule}
  `;

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${document.baseURI}">${copiedStyles}<style>${overrideCss}</style></head><body>${source.outerHTML}</body></html>`);
  doc.close();

  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  await Promise.race([
    Promise.all(links.map(link => new Promise<void>(resolve => {
      if (link.sheet) { resolve(); return; }
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => resolve(), { once: true });
    }))),
    new Promise<void>(resolve => window.setTimeout(resolve, 800)),
  ]);
  try { await doc.fonts?.ready; } catch { /* print with available fonts */ }
  await new Promise<void>(resolve => window.setTimeout(resolve, 80));

  if (mode === 'thermal') {
    const paper = doc.querySelector<HTMLElement>('.invoice-paper');
    if (paper) {
      const heightPx = Math.max(paper.scrollHeight, paper.getBoundingClientRect().height);
      const heightMm = Math.max(40, Math.ceil((heightPx * 25.4 / 96) + 2));
      const rollStyle = doc.createElement('style');
      rollStyle.textContent = `@page{size:${thermalWidth} ${heightMm}mm;margin:0;}html,body{width:${thermalWidth}!important;max-width:${thermalWidth}!important;margin:0!important;padding:0!important;}.invoice-paper{width:${thermalWidth}!important;max-width:${thermalWidth}!important;margin:0!important;}`;
      doc.head.appendChild(rollStyle);
      await new Promise<void>(resolve => window.setTimeout(resolve, 50));
    }
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.setTimeout(() => frame.remove(), 0);
  };
  win.addEventListener('afterprint', cleanup, { once: true });
  win.focus();
  win.print();
  window.setTimeout(cleanup, 5000);
}
