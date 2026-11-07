// Page snapshot for phones. getDisplayMedia cannot capture the screen on iOS, so this paints the
// document itself. html2canvas draws with its own renderer; html-to-image relies on SVG foreignObject,
// which Safari often leaves blank. Cross-origin images are requested with CORS and dropped if the host
// refuses — a missing photo does not fail the shot. Output is WebP when the browser can encode it, else JPEG.
import { redactClone } from './redact';
const MAX_PIXELS = 1_200_000;
const TARGET_CHARS = 900_000;

export function captureScale(cssWidth, cssHeight, dpr) {
  const ratio = Math.min(Math.max(Number(dpr) || 1, 1), 2);
  const w = Math.max(1, cssWidth), h = Math.max(1, cssHeight);
  if (w * h * ratio * ratio <= MAX_PIXELS) return ratio;
  return Math.max(0.2, Math.sqrt(MAX_PIXELS / (w * h)));
}

export function compressCanvas(canvas, targetChars = TARGET_CHARS) {
  const webp = canvas.toDataURL('image/webp', 0.7);
  const mime = webp.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  let quality = 0.7;
  let url = mime === 'image/webp' ? webp : canvas.toDataURL(mime, quality);
  while (url.length > targetChars && quality > 0.35) {
    quality = Math.round((quality - 0.1) * 10) / 10;
    url = canvas.toDataURL(mime, quality);
  }
  if (url.length <= targetChars) return url;
  const scale = Math.max(0.3, Math.sqrt(targetChars / url.length) * 0.85);
  const next = document.createElement('canvas');
  next.width = Math.max(1, Math.floor(canvas.width * scale));
  next.height = Math.max(1, Math.floor(canvas.height * scale));
  next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height);
  return next.toDataURL(mime, 0.7);
}

function shootOptions(html2canvas, stripImages) {
  const vw = window.innerWidth, vh = window.innerHeight;
  return html2canvas(document.documentElement, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 4000,
    scale: captureScale(vw, vh, window.devicePixelRatio),
    x: window.scrollX,
    y: window.scrollY,
    width: vw,
    height: vh,
    scrollX: 0,
    scrollY: 0,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: vh,
    ignoreElements: el => !!el?.closest?.('[data-bug-reporter]'),
    onclone(doc) {
      redactClone(doc);
      doc.querySelectorAll('[data-bug-reporter]').forEach(el => el.remove());
      doc.querySelectorAll('img').forEach(img => {
        if (stripImages) { img.remove(); return; }
        const src = img.getAttribute('src') || '';
        if (!src) return;
        try {
          const u = new URL(src, doc.baseURI || location.href);
          if (u.origin !== location.origin) img.crossOrigin = 'anonymous';
        } catch { img.remove(); }
      });
    },
  });
}

export async function captureViewport() {
  if (typeof window === 'undefined') throw new Error('Capture runs in the browser.');
  const { default: html2canvas } = await import('html2canvas');
  const lib = html2canvas?.default || html2canvas;
  try {
    return compressCanvas(await shootOptions(lib, false));
  } catch {
    return compressCanvas(await shootOptions(lib, true));
  }
}
