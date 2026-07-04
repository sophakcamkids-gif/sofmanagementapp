/**
 * Mobile-friendly PDF / PNG export of an on-screen element.
 * Ported from the CCC school app — proven on iOS Safari, Android, and in-app
 * browsers (Telegram / Messenger) where <a download> and gesture-expired popups
 * are unreliable.
 */

import jsPDF from 'jspdf';
// html2canvas-pro (maintained fork) supports modern CSS colour functions like
// oklch(), which Tailwind v4 emits. The original html2canvas 1.x throws on oklch.
import html2canvas from 'html2canvas-pro';

// iPhone, iPod, and iPadOS (which reports itself as "MacIntel" but has touch).
const isIOS = (): boolean =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isMobile = (): boolean =>
  isIOS() || /Android|Mobile/i.test(navigator.userAgent) ||
  (typeof window !== 'undefined' && 'ontouchstart' in window && navigator.maxTouchPoints > 0);

// Show a rendered image full-screen IN the app so the user can long-press →
// "Save Image" (mobile) or use the download button. This sidesteps the phone
// problems that broke image download: after the async html2canvas render the tap
// gesture has expired, so window.open()/navigator.share()/<a download> are
// blocked by mobile browsers. Showing it in-place needs no gesture and no
// download permission — it always works.
const showImageOverlay = (dataUrl: string, filename: string): void => {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:14px;overflow:auto;font-family:system-ui,sans-serif;';
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#fff;font-size:15px;font-weight:700;text-align:center;max-width:92%;line-height:1.5;';
  hint.textContent = '📲 ចុចលើរូបឱ្យយូរ រួចជ្រើស «Save Image / រក្សាទុករូបភាព»';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = filename;
  img.style.cssText = 'max-width:100%;max-height:74vh;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);background:#fff;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
  const dl = document.createElement('a');
  dl.href = dataUrl; dl.download = filename; dl.textContent = '⬇ ទាញយក';
  dl.style.cssText = 'background:#0ea5e9;color:#fff;padding:9px 18px;border-radius:10px;font-weight:700;text-decoration:none;';
  const close = document.createElement('button');
  close.textContent = '✕ បិទ';
  close.style.cssText = 'background:#e2e8f0;color:#334155;padding:9px 18px;border-radius:10px;font-weight:700;border:0;cursor:pointer;';
  close.onclick = () => overlay.remove();
  row.appendChild(dl); row.appendChild(close);
  overlay.append(hint, img, row);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
};

// Deliver a finished blob to the user.
//   • Desktop / Android: <a download> saves the file directly.
//   • iOS Safari & in-app browsers: <a download> and gesture-expired popups are
//     unreliable. Try a new tab; if blocked, navigate THIS tab to the blob — that
//     always renders the file, and the user saves it via the Share sheet.
const deliverBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  if (isIOS()) {
    const w = window.open(url, '_blank');
    if (!w) window.location.href = url; // popup blocked → open in place
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

// Copy the LIVE values of form fields into a cloned subtree. cloneNode() copies
// the HTML but NOT the current value/checked state of <input>/<textarea>/<select>,
// so without this the report's editable fields (borrower, guarantors…) capture blank.
function syncFieldValues(src: HTMLElement, dst: HTMLElement): void {
  const s = src.querySelectorAll('input, textarea, select');
  const d = dst.querySelectorAll('input, textarea, select');
  s.forEach((node, i) => {
    const from = node as HTMLInputElement;
    const to = d[i] as HTMLInputElement | undefined;
    if (!to) return;
    if (from.type === 'checkbox' || from.type === 'radio') to.checked = from.checked;
    else { to.value = from.value; to.setAttribute('value', from.value); }
  });
}

// Rasterize a DOM element to a canvas at a FIXED design width, regardless of the
// device. The report is cloned into an off-screen sandbox sized to `fixedWidth`,
// so neither the phone's narrow viewport nor the on-screen FitToWidth scale/@media
// breakpoints affect the output — the capture is byte-for-byte the same layout on
// a phone and a PC. (Capturing the live element let html2canvas inherit the mobile
// viewport, collapsing 2-column grids to 1 column — the reported distortion.)
let _h2cWarmed = false;
async function renderElementToCanvas(el: HTMLElement, fixedWidth?: number): Promise<HTMLCanvasElement> {
  // Wait for the Khmer web fonts (incl. BOLD) to finish loading, else html2canvas
  // can't measure glyphs and header text can come out blank. Then settle briefly.
  try { await (document as any).fonts?.ready; } catch { /* fonts API absent — proceed */ }
  await new Promise(resolve => setTimeout(resolve, 50));

  const width = fixedWidth ?? Math.max(el.scrollWidth, el.offsetWidth, 800);
  const scale = Math.min(2.5, Math.max(1.5, 1500 / width));

  // Off-screen sandbox pinned to the design width. `position:fixed` + far-left keeps
  // it out of view (no flash) and, because it's not inside FitToWidth, the clone
  // lays out at its true desktop width. The media queries below force the desktop
  // breakpoints since the sandbox is invisible to @media (viewport stays narrow).
  const sandbox = document.createElement('div');
  const sid = 'sof-export-sandbox';
  sandbox.id = sid;
  sandbox.style.cssText =
    `position:fixed;left:-100000px;top:0;width:${width}px;background:#ffffff;` +
    `z-index:-1;pointer-events:none;`;

  const bp = document.createElement('style');
  bp.textContent = `
    #${sid} .sm\\:grid-cols-2, #${sid} .md\\:grid-cols-2, #${sid} .lg\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
    #${sid} .sm\\:grid-cols-3, #${sid} .md\\:grid-cols-3, #${sid} .lg\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0,1fr)) !important; }
    #${sid} .sm\\:grid-cols-4, #${sid} .md\\:grid-cols-4, #${sid} .lg\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0,1fr)) !important; }
    #${sid} .sm\\:flex-row, #${sid} .md\\:flex-row { flex-direction: row !important; }
    #${sid} .sm\\:p-10, #${sid} .md\\:p-10 { padding: 2.5rem !important; }
    #${sid} .sm\\:p-8,  #${sid} .md\\:p-8  { padding: 2rem !important; }
    #${sid} .md\\:pr-4 { padding-right: 1rem !important; }
  `;

  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.width = `${width}px`;
  clone.style.maxWidth = 'none';
  clone.style.margin = '0';
  clone.style.transform = 'none';
  // Hide screen-only chrome (download buttons, month/year pickers) so it matches print.
  clone.querySelectorAll<HTMLElement>('.no-print, .rc-no-print').forEach(n => { n.style.display = 'none'; });
  // Neutralize any FitToWidth scaling that got cloned along with the subtree.
  clone.querySelectorAll<HTMLElement>('.rc-fit-outer, .rc-fit-frame, .rc-fit-inner').forEach(n => {
    n.style.transform = 'none'; n.style.width = 'auto'; n.style.maxWidth = 'none';
    n.style.height = 'auto'; n.style.overflow = 'visible'; n.style.margin = '0';
  });

  sandbox.appendChild(bp);
  sandbox.appendChild(clone);
  document.body.appendChild(sandbox);
  syncFieldValues(el, clone);

  // html2canvas renders <input>/<select> text unreliably across browsers (esp. on
  // mobile the value often comes out blank). Replace each form control in the clone
  // with a static <span> carrying its value, so the snapshot is identical on every
  // device. The controls already have their live values from syncFieldValues.
  clone.querySelectorAll<HTMLElement>('input, textarea, select').forEach(node => {
    const ctrl = node as HTMLInputElement;
    let text = ctrl.value;
    if (ctrl.tagName === 'SELECT') {
      const sel = node as unknown as HTMLSelectElement;
      text = sel.options[sel.selectedIndex]?.text ?? ctrl.value;
    } else if (ctrl.type === 'checkbox' || ctrl.type === 'radio') {
      text = ctrl.checked ? '✓' : '';
    }
    const cs = window.getComputedStyle(ctrl);
    const span = document.createElement('span');
    span.textContent = text;
    span.className = ctrl.className;
    span.style.cssText =
      `display:inline-block;box-sizing:border-box;` +
      `width:${ctrl.style.width || cs.width};` +
      `font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};` +
      `color:${cs.color};text-align:${cs.textAlign};padding:${cs.padding};` +
      `line-height:${cs.lineHeight};white-space:nowrap;`;
    ctrl.replaceWith(span);
  });

  // html2canvas on iOS Safari drops CSS that comes from Tailwind class rules —
  // especially colours (Tailwind v4 emits oklch(), which the iOS build can't parse)
  // plus borders / backgrounds / text-align / flex / grid — so exports lose their
  // boxes, table lines, colours and centering. Copy the resolved values back onto
  // every clone node as INLINE styles, which html2canvas honours on every device.
  //
  // getComputedStyle returns colours in their AUTHORED space (still oklch), so
  // rasterise a 1px sample to force a plain rgb() that html2canvas can parse.
  const _cvs = document.createElement('canvas'); _cvs.width = _cvs.height = 1;
  const _ctx = _cvs.getContext('2d', { willReadFrequently: true });
  const _colorCache = new Map<string, string>();
  const toRgb = (c: string): string => {
    if (!c) return c;
    const hit = _colorCache.get(c);
    if (hit !== undefined) return hit;
    let out = c;
    try {
      _ctx!.clearRect(0, 0, 1, 1);
      _ctx!.fillStyle = 'rgba(0,0,0,0)';
      _ctx!.fillStyle = c;
      _ctx!.fillRect(0, 0, 1, 1);
      const d = _ctx!.getImageData(0, 0, 1, 1).data;
      out = d[3] === 0 ? 'transparent' : `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    } catch { /* unparseable — keep original */ }
    _colorCache.set(c, out);
    return out;
  };
  const paint = (e: HTMLElement) => {
    const cs = window.getComputedStyle(e);
    e.style.color = toRgb(cs.color);
    const bg = toRgb(cs.backgroundColor);
    if (bg !== 'transparent') e.style.backgroundColor = bg;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0) {
        e.style.setProperty(`border-${side}`,
          `${cs.getPropertyValue(`border-${side}-width`)} ${cs.getPropertyValue(`border-${side}-style`)} ${toRgb(cs.getPropertyValue(`border-${side}-color`))}`);
      }
    }
    if (cs.borderRadius && cs.borderRadius !== '0px') e.style.borderRadius = cs.borderRadius;
    if (cs.textAlign && cs.textAlign !== 'start') e.style.textAlign = cs.textAlign;
    // Images: pin the laid-out size inline. html2canvas on iOS otherwise ignores
    // class-based sizing (max-h-16, w-full…) and draws the image at its natural
    // resolution — e.g. the signature ballooned to fill the page.
    if (e.tagName === 'IMG') {
      e.style.width = cs.width;
      e.style.height = cs.height;
      e.style.objectFit = cs.objectFit;
    }
    const disp = cs.display;
    if (disp === 'grid' || disp === 'inline-grid') {
      e.style.display = disp;
      e.style.gridTemplateColumns = cs.gridTemplateColumns;
      e.style.gap = cs.gap;
    } else if (disp === 'flex' || disp === 'inline-flex') {
      e.style.display = disp;
      e.style.flexDirection = cs.flexDirection;
      e.style.justifyContent = cs.justifyContent;
      e.style.alignItems = cs.alignItems;
      e.style.flexWrap = cs.flexWrap;
      e.style.gap = cs.gap;
    }
  };
  paint(clone);
  clone.querySelectorAll<HTMLElement>('*').forEach(paint);

  const options = {
    scale,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 15000,
    windowWidth: width,
  };

  try {
    await (document as any).fonts?.ready;
    await new Promise(resolve => setTimeout(resolve, 40));
    // The FIRST capture after page load can mis-render (fonts not yet in the clone).
    // Prime it ONCE with a throwaway low-res render so the first real export is warm.
    if (!_h2cWarmed) {
      _h2cWarmed = true;
      try { await html2canvas(clone, { ...options, scale: 0.5 }); } catch { /* warm-up only */ }
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return await html2canvas(clone, options);
  } finally {
    sandbox.remove();
  }
}

// Render an element to a single-image PDF page (landscape if wider than tall).
export async function exportElementToPdf(el: HTMLElement, filename: string, fixedWidth?: number): Promise<void> {
  const canvas = await renderElementToCanvas(el, fixedWidth);
  const imgW = canvas.width;
  const imgH = canvas.height;
  const orientation = imgW >= imgH ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const ratio = Math.min(pageW / imgW, pageH / imgH);
  const w = imgW * ratio;
  const h = imgH * ratio;
  const x = (pageW - w) / 2;
  const y = (pageH - h) / 2;

  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, h, undefined, 'FAST');
  const name = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  deliverBlob(pdf.output('blob'), name);
}

// Rasterize an element and return the PNG as a data URL (no download / overlay).
// Used to attach an on-screen sheet (e.g. a loan-request template) to a Telegram
// message.
export async function renderElementToPngDataUrl(el: HTMLElement, fixedWidth?: number): Promise<string> {
  const canvas = await renderElementToCanvas(el, fixedWidth);
  return canvas.toDataURL('image/png');
}

// Render an element to a downloadable PNG image (mobile: in-app overlay).
export async function exportElementToImage(el: HTMLElement, filename: string, fixedWidth?: number): Promise<void> {
  const canvas = await renderElementToCanvas(el, fixedWidth);
  const name = filename.endsWith('.png') ? filename : `${filename}.png`;
  if (isMobile()) {
    showImageOverlay(canvas.toDataURL('image/png'), name);
    return;
  }
  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob returned null');
  deliverBlob(blob, name);
}
