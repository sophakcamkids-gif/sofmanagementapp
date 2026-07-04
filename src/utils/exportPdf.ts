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

// Rasterize a DOM element to a canvas. Because it's a snapshot it looks
// pixel-identical on every device (no reflow). Normalized to ~1500px wide so
// quality is the same on phone or PC.
let _h2cWarmed = false;
async function renderElementToCanvas(el: HTMLElement, fixedWidth?: number): Promise<HTMLCanvasElement> {
  // Wait for the Khmer web fonts (incl. BOLD) to finish loading, else html2canvas
  // can't measure glyphs and header text can come out blank. Then settle briefly.
  try { await (document as any).fonts?.ready; } catch { /* fonts API absent — proceed */ }
  await new Promise(resolve => setTimeout(resolve, 50));

  const renderWidth = fixedWidth ?? Math.max(el.scrollWidth, el.offsetWidth, 800);
  const scale = Math.min(2.5, Math.max(1.5, 1500 / renderWidth));
  const options = {
    scale,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 15000,
    windowWidth: renderWidth,
    ...(fixedWidth ? { width: fixedWidth, windowWidth: fixedWidth } : {}),
    onclone: (doc: Document) => {
      if (fixedWidth && el.id) {
        const root = doc.getElementById(el.id);
        if (root) {
          root.style.width = `${fixedWidth}px`;
          root.style.maxWidth = 'none';
          let p = root.parentElement;
          for (let i = 0; p && i < 5; i++, p = p.parentElement) { p.style.maxWidth = 'none'; }
        }
      }
      // Hide screen-only chrome (buttons, upload placeholders) so it matches print.
      doc.querySelectorAll<HTMLElement>('.no-print, .rc-no-print').forEach(n => { n.style.display = 'none'; });
    },
  };

  // The FIRST capture after page load can mis-render (fonts not yet in the clone).
  // Prime it ONCE with a throwaway low-res render so the first real export is warm.
  if (!_h2cWarmed) {
    _h2cWarmed = true;
    try { await html2canvas(el, { ...options, scale: 0.5 }); } catch { /* warm-up only */ }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  return html2canvas(el, options);
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
