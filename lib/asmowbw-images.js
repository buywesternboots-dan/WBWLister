// Server-only image work for ASMOwbw. Do not import this from client components (sharp is Node-only).
import { CONTENT_FIELDS, JPEG_QUALITY, MAX_EDGE, WEBP_QUALITY, namingSource, planMedia } from './asmowbw';
import { withXmp } from './seo';

const arr = v => (Array.isArray(v) ? v : []);

export async function loadSharp() {
  try { return (await import('sharp')).default; }
  catch { return null; }
}

function gpsPresent(buf) {
  if (!buf || buf.length < 16) return false;
  const s = Buffer.from(buf).toString('latin1');
  return /\x00GPS|\x00gps|GPSLatitude|GPSLongitude/.test(s);
}

// Resize, compress, write JPEG + WebP, strip GPS and other EXIF. JPEG XMP is added by the caller (withXmp) at serve or store time.
export async function optimizeBytes(bytes, sharpFn) {
  const sharp = sharpFn ?? await loadSharp();
  if (!sharp) return { ok: false, error: 'Image optimizer is not available.' };
  const src = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    const meta = await sharp(src).metadata();
    const pipeline = sharp(src).rotate().resize({
      width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true,
    });
    const jpeg = await pipeline.clone().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    const webp = await pipeline.clone().webp({ quality: WEBP_QUALITY }).toBuffer();
    const out = await sharp(jpeg).metadata();
    return {
      ok: true,
      jpeg, webp,
      width: out.width ?? meta.width ?? null,
      height: out.height ?? meta.height ?? null,
      had_gps: gpsPresent(meta.exif) || gpsPresent(src),
      has_gps: gpsPresent(jpeg) || gpsPresent(webp),
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Photo could not be optimized.' };
  }
}

export function withJpegMeta(buf, item, n) {
  return withXmp(buf, item, n);
}

// One listing, on command. Photos are read and optionally stored through injected functions so tests do not hit the network.
// Listing content fields are never included in the returned patch.
export async function runListing(input, opt = {}) {
  const plan = planMedia(input, opt);
  const item = namingSource({ ...input, brand: plan.brand || input.brand, style_ref: plan.style ? { ...(input.style_ref ?? {}), style_number: plan.style } : input.style_ref });
  const readPhoto = opt.readPhoto;
  const storePhoto = opt.storePhoto;
  const sharpFn = opt.sharp ?? await loadSharp();
  const images = [];
  const changes = [];
  for (const im of plan.images) {
    const next = { ...im, og: { ...im.og } };
    const sidecar = arr(input.media).find(m => m.n === im.n);
    let bytes = sidecar?.bytes ? Buffer.from(sidecar.bytes) : null;
    if (!bytes && readPhoto && im.stored_url) {
      try {
        const got = await readPhoto(im.stored_url);
        bytes = got?.body ?? got;
        if (bytes && !Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
      } catch (e) {
        next.pixels = 'failed';
        next.error = e?.message || 'Photo could not be read.';
        images.push(next);
        changes.push({ n: im.n, file: im.file, alt: im.alt, pixels: next.pixels, error: next.error });
        continue;
      }
    }
    if (!bytes) {
      next.pixels = 'unchanged';
      next.note = 'Original pixels kept; SEO name, alt text, and caption were still applied.';
      images.push(next);
      changes.push({ n: im.n, file: im.file, alt: im.alt, pixels: next.pixels });
      continue;
    }
    const out = await optimizeBytes(bytes, sharpFn);
    if (!out.ok) {
      next.pixels = 'failed';
      next.error = out.error;
      images.push(next);
      changes.push({ n: im.n, file: im.file, alt: im.alt, pixels: next.pixels, error: next.error });
      continue;
    }
    next.width = out.width;
    next.height = out.height;
    next.og.width = out.width;
    next.og.height = out.height;
    next.had_gps = !!out.had_gps;
    next.gps_stripped = !!out.had_gps && !out.has_gps;
    // Store clean pixels (GPS already stripped). The public /img route adds XMP on JPEG responses.
    if (storePhoto) {
      try {
        next.jpeg_url = await storePhoto(`asmowbw/${input.id}/${im.n}/${im.file}`, out.jpeg, 'image/jpeg') || null;
        next.webp_url = await storePhoto(`asmowbw/${input.id}/${im.n}/${im.webp_file}`, out.webp, 'image/webp') || null;
      } catch {
        next.jpeg_url = null;
        next.webp_url = null;
      }
    }
    next.pixels = next.jpeg_url || next.webp_url ? 'optimized' : 'optimized-unstored';
    if (opt.keepBuffers) { next.jpeg = withJpegMeta(out.jpeg, item, im.n); next.webp = out.webp; }
    images.push(next);
    changes.push({
      n: im.n, file: im.file, alt: im.alt, caption: im.caption,
      pixels: next.pixels, width: next.width, height: next.height,
      jpeg_url: next.jpeg_url, webp_url: next.webp_url, gps_stripped: next.gps_stripped || false,
    });
  }
  const record = {
    media: 'asmowbw',
    applied_at: opt.now ?? new Date().toISOString(),
    facts_fp: plan.facts_fp,
    seo_title: plan.seo_title,
    seo_description: plan.seo_description,
    images,
    credit: plan.credit,
    style: plan.style,
    brand: plan.brand,
  };
  return {
    ok: true,
    patch: { asmowbw: record },
    content_unchanged: CONTENT_FIELDS,
    summary: {
      id: input.id,
      photos: images.length,
      optimized: images.filter(i => i.pixels === 'optimized' || i.pixels === 'optimized-unstored').length,
      unchanged: images.filter(i => i.pixels === 'unchanged').length,
      failed: images.filter(i => i.pixels === 'failed').length,
      style: plan.style,
      seo_title: plan.seo_title,
      changes,
    },
    record,
  };
}
