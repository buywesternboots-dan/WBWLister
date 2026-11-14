// Free in-browser listing video: pick photos and compute a Ken Burns timeline.
// The browser records the canvas with captureStream + MediaRecorder (no paid API).

export const ASPECTS = {
  square: { width: 1080, height: 1080, label: 'Square' },
  '9:16': { width: 1080, height: 1920, label: '9:16' },
};
export const DEFAULT_ASPECT = 'square';
export const MAX_PHOTOS = 6;
export const PHOTO_MS = 2500;
export const FADE_MS = 400;
export const FPS = 30;

export const canvasSize = (aspect = DEFAULT_ASPECT) => ASPECTS[aspect] ?? ASPECTS.square;

export function selectPhotos(photos, max = MAX_PHOTOS) {
  return (Array.isArray(photos) ? photos : [])
    .filter(src => typeof src === 'string' && src.trim())
    .slice(0, max);
}

// Same-origin /img/:id/:n/:name route (the name is only a label). Using this, not the
// stored Blob or source CDN URL, keeps the canvas untainted so MediaRecorder can run.
export function listingPhotoUrl(origin, item, n) {
  if (item?.id == null || !Number(n)) return null;
  const base = String(origin ?? '').replace(/\/$/, '');
  return `${base}/img/${item.id}/${n}/photo.jpg`;
}

export function listingVideoSources(item, origin) {
  return selectPhotos(item?.photos).map((_, i) => listingPhotoUrl(origin, item, i + 1)).filter(Boolean);
}

export function kenBurnsRange(index) {
  return index % 2 === 0
    ? { from: { scale: 1, x: -0.06, y: -0.03 }, to: { scale: 1.12, x: 0.06, y: 0.03 } }
    : { from: { scale: 1.12, x: 0.06, y: 0.04 }, to: { scale: 1, x: -0.05, y: -0.02 } };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
export const clamp01 = t => Math.min(1, Math.max(0, t));

export function kenBurnsAt(range, t) {
  const p = clamp01(t);
  return {
    scale: lerp(range.from.scale, range.to.scale, p),
    x: lerp(range.from.x, range.to.x, p),
    y: lerp(range.from.y, range.to.y, p),
  };
}

export function buildTimeline(count, { photoMs = PHOTO_MS, fadeMs = FADE_MS, aspect = DEFAULT_ASPECT } = {}) {
  const n = Math.max(0, Math.min(MAX_PHOTOS, Number(count) || 0));
  const { width, height } = canvasSize(aspect);
  if (!n) return { width, height, aspect, durationMs: 0, clips: [] };
  const fade = n === 1 ? 0 : Math.min(fadeMs, Math.floor(photoMs / 2));
  const clips = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const startMs = t, endMs = startMs + photoMs;
    clips.push({ index: i, startMs, endMs, fadeInMs: i === 0 ? 0 : fade, fadeOutMs: i === n - 1 ? 0 : fade, ...kenBurnsRange(i) });
    t = endMs - fade;
  }
  return { width, height, aspect, durationMs: clips[n - 1].endMs, clips };
}

export function clipOpacity(clip, timeMs) {
  const local = timeMs - clip.startMs, dur = clip.endMs - clip.startMs;
  if (local < 0 || timeMs >= clip.endMs) return 0;
  let opacity = 1;
  if (clip.fadeInMs && local < clip.fadeInMs) opacity = local / clip.fadeInMs;
  if (clip.fadeOutMs && local > dur - clip.fadeOutMs) opacity = Math.min(opacity, (clip.endMs - timeMs) / clip.fadeOutMs);
  return clamp01(opacity);
}

export function clipsAt(timeline, timeMs) {
  return timeline.clips.flatMap(clip => {
    const opacity = clipOpacity(clip, timeMs);
    if (!opacity) return [];
    const dur = clip.endMs - clip.startMs;
    const progress = easeInOut(clamp01(dur ? (timeMs - clip.startMs) / dur : 0));
    return [{ ...clip, opacity, progress, transform: kenBurnsAt(clip, progress) }];
  });
}

// object-fit: cover, then Ken Burns scale/pan. x,y in [-1, 1] shift by half the overflow.
export function coverRect(imgW, imgH, canvasW, canvasH, { scale, x, y }) {
  const cover = Math.max(canvasW / imgW, canvasH / imgH) * scale;
  const dw = imgW * cover, dh = imgH * cover;
  return {
    dx: (canvasW - dw) / 2 + x * (Math.abs(dw - canvasW) / 2),
    dy: (canvasH - dh) / 2 + y * (Math.abs(dh - canvasH) / 2),
    dw, dh,
  };
}

const MIME_CANDIDATES = ['video/mp4', 'video/mp4;codecs="avc1.42E01E"', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickRecorderMime(isTypeSupported) {
  const check = isTypeSupported ?? (typeof MediaRecorder !== 'undefined' ? t => MediaRecorder.isTypeSupported(t) : () => false);
  return MIME_CANDIDATES.find(t => { try { return check(t); } catch { return false; } }) || '';
}

export const videoExtension = mime => /mp4/i.test(mime || '') ? 'mp4' : 'webm';

export function videoFileName(item, mime) {
  const slug = String(item?.title || item?.id || 'listing').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'listing';
  return `${slug}-video.${videoExtension(mime)}`;
}

export function drawFrame(ctx, images, timeline, timeMs) {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, timeline.width, timeline.height);
  for (const clip of clipsAt(timeline, timeMs)) {
    const img = images[clip.index];
    if (!img?.width || !img.height) continue;
    const r = coverRect(img.width, img.height, timeline.width, timeline.height, clip.transform);
    ctx.save();
    ctx.globalAlpha = clip.opacity;
    ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  }
}

async function loadBitmap(src) {
  const res = await fetch(src, { mode: 'cors', credentials: 'same-origin' });
  if (!res.ok) throw new Error('photo');
  return createImageBitmap(await res.blob());
}

// Records the timeline off a canvas already in the document. Photos are fetched as blobs
// through /img/ so a cross-origin CDN URL cannot taint the canvas.
export async function recordListingVideo({ item, origin, canvas, aspect = DEFAULT_ASPECT, onProgress } = {}) {
  if (!canvas?.getContext) throw new Error('No canvas to record.');
  if (typeof canvas.captureStream !== 'function') throw new Error('This browser cannot record a canvas to video.');
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (MediaRecorder is missing).');
  const sources = listingVideoSources(item, origin);
  if (!sources.length) throw new Error('This listing has no photos to make a video from.');
  const timeline = buildTimeline(sources.length, { aspect });
  canvas.width = timeline.width;
  canvas.height = timeline.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  let images;
  try {
    images = await Promise.all(sources.map(loadBitmap));
  } catch {
    throw new Error("A listing photo could not be loaded. Photos are fetched through this site's /img/ route so the video canvas is not blocked by CORS. If this keeps happening, the stored photo may be missing.");
  }
  const mime = pickRecorderMime();
  const stream = canvas.captureStream(FPS);
  let rec;
  try { rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 }) : new MediaRecorder(stream); }
  catch { rec = new MediaRecorder(stream); }
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    rec.onerror = () => reject(new Error('Recording failed.'));
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' }));
  });
  drawFrame(ctx, images, timeline, 0);
  rec.start(200);
  const started = performance.now();
  await new Promise(resolve => {
    const tick = now => {
      const t = Math.min(now - started, timeline.durationMs);
      drawFrame(ctx, images, timeline, t);
      onProgress?.(timeline.durationMs ? t / timeline.durationMs : 1);
      if (t >= timeline.durationMs) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  stream.getTracks().forEach(t => t.stop());
  const blob = await done;
  images.forEach(img => img.close?.());
  const type = blob.type || mime || 'video/webm';
  return { blob, mime: type, fileName: videoFileName(item, type) };
}
