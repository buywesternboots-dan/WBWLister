// Store asmoWBW prepared photos as the listing's stored photos, and undo that apply.
// Naming and pixel work stay in the Python tool. Original source blobs are never overwritten.
import { listingInput } from './asmo-wbw-input';
import { contentTypeFor, sniffFormat } from './photo-meta';

export { listingInput };
export const ASMO_LABEL = 'asmoWBW';
export const ASMO_MEDIA = 'asmowbw';
export const MIN_SHORT_EDGE = 1000;
export const SMALL_FILE_BYTES = 50 * 1024;

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

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

export function withPrevious(current, previous) {
  if (!previous) return current;
  const { previous: _drop, ...kept } = previous;
  return { ...current, previous: kept };
}

export function storedRecord(result, opt = {}) {
  const now = opt.now || new Date().toISOString();
  const images = (result?.images ?? []).map((im, i) => ({
    n: im.n ?? i + 1,
    file: im.filename || im.file || `photo-${im.n ?? i + 1}.jpg`,
    filename: im.filename || im.file || `photo-${im.n ?? i + 1}.jpg`,
    alt: im.alt,
    caption: im.caption,
    title: im.title,
    keywords: im.keywords,
    stored_url: im.stored_url,
    original_url: im.original_url,
    width: im.width ?? null,
    height: im.height ?? null,
    format: im.format ?? null,
    gps_stripped: !!im.gps_stripped,
    metadata_written: im.metadata_written ?? null,
    orientation: im.orientation ?? null,
    color_mode: im.color_mode ?? null,
    converted: !!im.converted,
    converted_from: im.converted_from ?? null,
    warnings: im.warnings ?? [],
    op_id: im.op_id ?? null,
    pixels: 'unchanged',
  }));
  return {
    media: ASMO_MEDIA,
    tool: result?.tool || ASMO_LABEL,
    version: result?.version ?? null,
    applied_at: now,
    facts_fp: result?.facts_fp ?? null,
    seo_title: result?.seo_title ?? null,
    seo_description: result?.seo_description ?? null,
    credit: result?.credit ?? null,
    images,
    original_photos: opt.original_photos ?? [],
    warnings: opt.warnings ?? result?.warnings ?? [],
    notes: result?.notes ?? [],
    errors: result?.errors ?? [],
    listing_text_readonly: true,
  };
}

// Prefer a stored asmoWBW pass when each prepared photo URL still matches items.photos.
export function appliedAsmo(item) {
  const applied = jsonField(item?.asmowbw);
  const photos = item?.photos ?? [];
  if (applied?.media !== ASMO_MEDIA) return null;
  if (!applied.images?.length || applied.images.length !== photos.length) return null;
  for (let i = 0; i < photos.length; i++) {
    if (applied.images[i]?.stored_url !== photos[i] || applied.images[i].n !== i + 1) return null;
  }
  return applied;
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
  if (!imagesIn.length) throw new Error('asmoWBW result has no images.');
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
    const path = `prepared/${item.id}/${n}/${crypto.randomUUID()}-${filename}`;
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
