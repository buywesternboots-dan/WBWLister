// Store, undo, and export helpers for an amcasoWBW result. Naming and pixel work stay in the Python tool.
import { createHash, randomUUID } from 'node:crypto';
import { listingInput, OG_BASE_URL, wbwEnv } from './amcaso-wbw-input';
import { contentTypeFor, sniffFormat } from './photo-meta';

export { listingInput, OG_BASE_URL };

export const AMCASO_LABEL = 'amcasoWBW';
export const AMCASO_MEDIA = 'asmowbw';
export const MIN_SHORT_EDGE = 1000;
export const SMALL_FILE_BYTES = 50 * 1024;
export const CONTENT_FIELDS = ['title', 'description', 'price', 'wbw_price', 'size', 'size_estimated'];

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

const arr = v => (Array.isArray(v) ? v : []);

// Hosts amcasoWBW itself will not fetch. BootLister also refuses to attach or fetch these.
const BLOCKED_HOSTS = [
  'westernbootworld.com',
  'ebay.com', 'ebay.co.uk', 'ebay.ca', 'ebay.com.au',
  'ebaystatic.com', 'ebayimg.com', 'ebaydesc.com',
];

export function isBlockedAmcasoHost(src) {
  try {
    const host = new URL(src).hostname.toLowerCase().replace(/\.$/, '');
    return BLOCKED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

export function isBlobPhoto(src) {
  try {
    const u = new URL(src), host = u.hostname.toLowerCase().replace(/\.$/, '');
    return u.protocol === 'https:' && (host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com'));
  } catch { return false; }
}

// True when BootLister may read this already-stored photo and hand the bytes (or URL) to amcasoWBW.
// eBay and westernbootworld.com are never fetched.
export function attachablePhotoUrl(src) {
  try {
    const u = new URL(src);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return false;
    if (isBlockedAmcasoHost(src)) return false;
    return true;
  } catch { return false; }
}

const FINGERPRINT_KEYS = [
  'id', 'seller', 'title', 'description', 'id_text', 'brand', 'sized_for', 'size', 'size_estimated',
  'width', 'material_type', 'material', 'material_cut', 'made_in', 'condition', 'color', 'keywords',
  'sole_length', 'sole_width', 'heel_height', 'shaft_circ', 'shaft_height', 'sole', 'heel', 'toe',
  'guessed', 'verified', 'photos', 'style_ref', 'sku',
];

export function inputFingerprint(input) {
  const src = input ?? {};
  const body = {};
  for (const k of FINGERPRINT_KEYS) body[k] = src[k] ?? null;
  return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
}

export function publicImagePath(listingId, n, filename) {
  const file = String(filename || 'photo.jpg').replace(/^.*\//, '');
  return `/img/${listingId}/${n}/${file}`;
}

export function amcasoOrigin(opt = {}) {
  const raw = opt.origin || opt.og_base_url || opt.env?.AMCASO_WBW_ORIGIN || opt.env?.ASMO_WBW_ORIGIN || wbwEnv('ORIGIN') || OG_BASE_URL;
  const origin = String(raw || OG_BASE_URL).trim().replace(/\/$/, '');
  return /^https:\/\//i.test(origin) ? origin : OG_BASE_URL;
}

export function isHttpsUrl(src) {
  try { return new URL(src).protocol === 'https:'; } catch { return false; }
}

// Derivatives are always written under asmowbw/. Original photo blobs live under photos/ (or a source URL) and must never be overwritten or deleted.
export function amcasoStorePath(listingId, n, filename) {
  const file = String(filename || 'photo.jpg').replace(/^.*\//, '').replace(/^\.+/, '');
  if (!file) throw new Error('AMCASO derivative is missing a file name.');
  return `asmowbw/${listingId}/${n}/${file}`;
}

export function assertNewDerivativePath(path, originals = []) {
  const p = String(path || '');
  if (!p || p.startsWith('photos/') || /(^|\/)photos\//.test(p) || p.includes('..')) {
    throw new Error('AMCASO must not overwrite original photo blobs.');
  }
  if (!p.startsWith('asmowbw/')) throw new Error('AMCASO may only write derivatives under asmowbw/.');
  for (const url of originals) {
    if (!url) continue;
    if (p === url) throw new Error('AMCASO must not overwrite original photo blobs.');
    try {
      const pathname = new URL(url).pathname.replace(/^\//, '');
      if (pathname && (p === pathname || p.endsWith('/' + pathname))) {
        throw new Error('AMCASO must not overwrite original photo blobs.');
      }
    } catch (e) {
      if (e?.message === 'AMCASO must not overwrite original photo blobs.') throw e;
    }
  }
  return p;
}

function pixelsFor(im) {
  if (im.pixels) return im.pixels;
  if (im.jpeg_url || im.webp_url || im.jpeg || im.webp) return 'optimized';
  if (im.source === 'url-not-fetched' || im.source === 'no-media') return 'unchanged';
  return 'unchanged';
}

export function storedRecord(result, opt = {}) {
  const now = opt.now || new Date().toISOString();
  const input_fp = opt.input_fp || (opt.input ? inputFingerprint(opt.input) : null);
  const source = result ?? {};
  const images = arr(source.images).map((im, i) => {
    const n = im.n ?? i + 1;
    return {
      n,
      file: im.filename || im.file || `photo-${n}.jpg`,
      filename: im.filename || im.file || `photo-${n}.jpg`,
      alt: im.alt,
      caption: im.caption,
      title: im.title,
      stored_url: im.stored_url,
      jpeg: im.jpeg || null,
      webp: im.webp || null,
      jpeg_url: im.jpeg_url ?? null,
      webp_url: im.webp_url ?? null,
      width: im.width ?? null,
      height: im.height ?? null,
      gps_stripped: !!im.gps_stripped,
      op_id: im.op_id ?? null,
      pixels: pixelsFor(im),
      source: im.source ?? null,
      confirm_queue: !!im.confirm_queue,
      // Prepared-photo apply (full-size original with embedded metadata).
      keywords: im.keywords,
      original_url: im.original_url,
      format: im.format ?? null,
      metadata_written: im.metadata_written ?? null,
      orientation: im.orientation ?? null,
      color_mode: im.color_mode ?? null,
      converted: !!im.converted,
      converted_from: im.converted_from ?? null,
      warnings: im.warnings ?? [],
    };
  });
  return {
    media: AMCASO_MEDIA,
    tool: source.tool || AMCASO_LABEL,
    version: source.version ?? null,
    applied_at: now,
    facts_fp: source.facts_fp ?? null,
    reused_applied: !!source.reused_applied,
    reused_source: source.reused_source ?? null,
    input_fp,
    seo_title: source.seo_title ?? null,
    seo_description: source.seo_description ?? null,
    open_graph: source.open_graph ?? null,
    credit: source.credit ?? null,
    images,
    flags: source.flags ?? null,
    omitted: source.omitted ?? [],
    notes: source.notes ?? [],
    errors: source.errors ?? [],
    confirm_queue: source.n_confirm || 0,
    original_photos: opt.original_photos ?? [],
    warnings: opt.warnings ?? source.warnings ?? [],
    listing_text_readonly: true,
    result: source,
  };
}

export function withPrevious(current, previous) {
  if (!previous) return current;
  const { previous: _drop, ...kept } = previous;
  return { ...current, previous: kept };
}

export function undoRecord(current) {
  if (!current) return { asmowbw: null, undone: false };
  if (current.previous) return { asmowbw: current.previous, undone: true };
  return { asmowbw: null, undone: true };
}

// Prefer a stored amcasoWBW pass when the photos and input facts still match that run.
export function appliedAmcaso(item, opt = {}) {
  const applied = jsonField(item?.asmowbw);
  const photos = item?.photos ?? [];
  if (applied?.media !== AMCASO_MEDIA) return null;
  if (!applied.images?.length || applied.images.length !== photos.length) return null;
  for (let i = 0; i < photos.length; i++) {
    if (applied.images[i]?.stored_url !== photos[i] || applied.images[i].n !== i + 1) return null;
  }
  if (applied.input_fp) {
    const fp = opt.input_fp ?? inputFingerprint(listingInput(item, opt.seller ?? { name: item.seller }));
    if (applied.input_fp !== fp) return null;
  }
  return applied;
}

export function amcasoSummaryLine(result) {
  const s = result?.summary ?? result ?? {};
  const bits = [`${s.photos ?? 0} photo(s) named`];
  if (s.optimized) bits.push(`${s.optimized} optimized`);
  if (s.unchanged) bits.push(`${s.unchanged} kept original pixels`);
  if (s.failed) bits.push(`${s.failed} failed`);
  if (s.style) bits.push(`style ${s.style}`);
  return bits.join(', ');
}

// Only the amcasoWBW record is written. Callers must not include photos or other listing fields in this patch.
export function listingPatch(record) {
  return { asmowbw: record };
}

// ---- Prepared-photo apply: store amcasoWBW's full-size prepared files as the listing photos. ----

const safeName = name => String(name || 'photo.jpg').replace(/^.*[\\/]/, '').replace(/^\.+/, '') || 'photo.jpg';

export function qualityWarnings(buf, width, height) {
  const warnings = [];
  const w = width, h = height;
  if (w && h) {
    const short = Math.min(w, h);
    if (short < MIN_SHORT_EDGE) warnings.push(`shortest edge ${short} px is under 1000 px`);
  }
  if (buf && buf.length < SMALL_FILE_BYTES) warnings.push(`file is ${Math.floor(buf.length / 1024)} KB (very small)`);
  return warnings;
}

function decodeFile(file) {
  if (file.bytes) return Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes);
  if (file.base64) return Buffer.from(file.base64, 'base64');
  throw new Error(`Prepared photo ${file.n ?? ''} is missing bytes.`);
}

// Upload each prepared file as a new object and make it the listing photo.
// putFn is required so tests never talk to Vercel Blob or R2.
export async function storePreparedPhotos(item, result, files, putFn, opt = {}) {
  if (typeof putFn !== 'function') throw new Error('A storage put function is required.');
  const originals = [...(item.photos ?? [])];
  const byN = new Map((files || []).map(f => [Number(f.n), f]));
  const imagesIn = result?.images ?? [];
  if (!imagesIn.length) throw new Error('amcasoWBW result has no images.');
  const photos = [];
  const images = [];
  const listingWarnings = [...(result.warnings ?? [])];
  for (let i = 0; i < imagesIn.length; i++) {
    const im = imagesIn[i];
    const n = im.n ?? i + 1;
    const file = byN.get(n);
    if (!file) throw new Error(`Prepared file for photo ${n} is missing.`);
    const bytes = decodeFile(file);
    const filename = safeName(file.filename || im.filename || im.file || `photo-${n}.jpg`);
    const fmt = sniffFormat(bytes);
    const type = file.contentType || contentTypeFor(fmt);
    const warnings = [...new Set([...(im.warnings || []), ...qualityWarnings(bytes, im.width, im.height)])];
    const path = `prepared/${item.id}/${n}/${randomUUID()}-${filename}`;
    if (path.includes('..') || /(^|\/)photos\//.test(path)) throw new Error('Prepared photos must not overwrite original photo blobs.');
    const saved = await putFn(path, bytes, { access: 'public', contentType: type });
    const url = saved?.url || saved;
    if (!url || typeof url !== 'string') throw new Error(`Storage did not return a URL for photo ${n}.`);
    photos.push(url);
    images.push({
      ...im,
      n,
      file: filename,
      filename,
      stored_url: url,
      original_url: originals[i] ?? im.stored_url,
      warnings,
      pixels: im.converted ? 'converted' : 'unchanged',
    });
    listingWarnings.push(...warnings);
  }
  const record = storedRecord({ ...result, images, warnings: [...new Set(listingWarnings)] }, {
    now: opt.now,
    original_photos: originals,
    warnings: [...new Set(listingWarnings)],
  });
  return { photos, asmowbw: withPrevious(record, jsonField(item.asmowbw)) };
}

export function undoPreparedPhotos(item) {
  const current = jsonField(item?.asmowbw);
  if (!current) return { photos: item?.photos, asmowbw: null, undone: false };
  return { photos: current.original_photos ?? item.photos, asmowbw: current.previous ?? null, undone: true };
}

export function decodeApplyFiles(files = []) {
  return files.map(f => ({ ...f, n: Number(f.n), bytes: f.bytes ? (Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.bytes)) : Buffer.from(f.base64 || '', 'base64') }));
}
