// amcasoWBW photo prep in JavaScript (port of amcaso_wbw/media.py prepare_wbw_image, v0.3.2).
// WBW path: the full-size original is passed through with title, description, and keywords written in.
// JPEG gets XMP + IPTC, PNG and WebP get XMP. Pixels, ICC, CMYK, and the EXIF orientation flag are kept;
// JPEG scan data is never re-encoded. EXIF GPS is removed. Still GIF/BMP are converted to JPEG (reported).
import { crc32 } from 'node:zlib';
import { splitJpeg } from './photo-meta';
import { qualityWarnings } from './amcaso-wbw';

export const COPYRIGHT = 'westernbootworld.com';
const XMP_NS = Buffer.from('http://ns.adobe.com/xap/1.0/\0');
const PS3 = Buffer.from('Photoshop 3.0\0');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_XMP_KEY = Buffer.from('XML:com.adobe.xmp');

export function sniff(b) {
  if (!b || !b.length) return 'unknown';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  const head = b.toString('latin1', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (head.startsWith('II*\0') || head.startsWith('MM\0*')) return 'tiff';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^avi[fs]$/.test(b.toString('latin1', 8, 12))) return 'avif';
  return 'unknown';
}
export const extFor = fmt => ({ jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif', bmp: '.bmp', tiff: '.tif', avif: '.avif' }[fmt] || '');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const metaOf = m => ({ title: m?.title || '', description: m?.description || '', keywords: [...(m?.keywords || [])], credit: m?.credit || '', copyright: m?.copyright || COPYRIGHT });

export function buildXmp(meta) {
  const m = metaOf(meta);
  const kw = m.keywords.filter(Boolean).map(k => `<rdf:li>${esc(k)}</rdf:li>`).join('');
  return Buffer.from('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
    + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">'
    + `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(m.title)}</rdf:li></rdf:Alt></dc:title>`
    + `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(m.description)}</rdf:li></rdf:Alt></dc:description>`
    + `<dc:subject><rdf:Bag>${kw}</rdf:Bag></dc:subject>`
    + `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${esc(m.copyright)}</rdf:li></rdf:Alt></dc:rights>`
    + `<photoshop:Credit>${esc(m.credit)}</photoshop:Credit>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>', 'utf8');
}

function iptcIim(meta) {
  const m = metaOf(meta);
  const rec = (ds, text) => {
    const raw = Buffer.from(text, 'utf8').subarray(0, 2048), head = Buffer.from([0x1c, 0x02, ds, 0, 0]);
    head.writeUInt16BE(raw.length, 3);
    return Buffer.concat([head, raw]);
  };
  const out = [];
  if (m.title) out.push(rec(5, m.title));
  for (const k of m.keywords) if (k) out.push(rec(25, k));
  if (m.credit) out.push(rec(110, m.credit), rec(80, m.credit));
  if (m.copyright) out.push(rec(116, m.copyright));
  if (m.description) out.push(rec(120, m.description));
  return Buffer.concat(out);
}

function appSeg(marker, payload) {
  if (payload.length + 2 > 65535) throw new Error('JPEG APP segment exceeds 64 KiB');
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function app13(iim) {
  const size = Buffer.alloc(4); size.writeUInt32BE(iim.length);
  const irb = Buffer.concat([Buffer.from('8BIM'), Buffer.from([0x04, 0x04, 0, 0]), size, iim, iim.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
  return appSeg(0xed, Buffer.concat([PS3, irb]));
}

// Photoshop IRB without the IPTC (0x0404) resource; null when nothing else is left.
function stripIptc(payload) {
  const data = payload.subarray(PS3.length), out = [];
  let i = 0;
  while (i < data.length) {
    if (data.toString('latin1', i, i + 4) !== '8BIM' || i + 7 > data.length) { out.push(data.subarray(i)); break; }
    const typ = data.readUInt16BE(i + 4), nameLen = data[i + 6];
    const sizeAt = i + 6 + 1 + nameLen + ((1 + nameLen) % 2);
    if (sizeAt + 4 > data.length) { out.push(data.subarray(i)); break; }
    const size = data.readUInt32BE(sizeAt);
    const end = sizeAt + 4 + size + (size % 2);
    if (typ !== 0x0404) out.push(data.subarray(i, end));
    i = end;
  }
  const rest = Buffer.concat(out);
  return rest.length ? Buffer.concat([PS3, rest]) : null;
}

// ---- EXIF (TIFF) helpers: GPS removal in place, orientation read. Offsets are never moved. ----
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
function tiffReader(t) {
  const order = t.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  return { u16: o => (le ? t.readUInt16LE(o) : t.readUInt16BE(o)), u32: o => (le ? t.readUInt32LE(o) : t.readUInt32BE(o)), w16: (o, v) => (le ? t.writeUInt16LE(v, o) : t.writeUInt16BE(v, o)) };
}
function ifdEntries(t, r, at) {
  if (at + 2 > t.length) return [];
  const n = r.u16(at), out = [];
  for (let k = 0; k < n; k++) {
    const e = at + 2 + k * 12;
    if (e + 12 > t.length) break;
    out.push({ at: e, tag: r.u16(e), type: r.u16(e + 2), count: r.u32(e + 4), value: e + 8 });
  }
  return out;
}

// Returns { tiff, gps } with GPS entries and their data zeroed and the GPS IFD emptied. tiff is a copy.
export function stripGpsTiff(src) {
  const t = Buffer.from(src);
  try {
    const r = tiffReader(t);
    if (!r) return { tiff: t, gps: false };
    const ptr = ifdEntries(t, r, r.u32(4)).find(e => e.tag === 0x8825);
    if (!ptr) return { tiff: t, gps: false };
    const gpsAt = r.u32(ptr.value), entries = ifdEntries(t, r, gpsAt);
    if (!entries.length) return { tiff: t, gps: false };
    for (const e of entries) {
      const size = (TYPE_SIZE[e.type] || 1) * e.count;
      if (size > 4) { const off = r.u32(e.value); if (off + size <= t.length) t.fill(0, off, off + size); }
      t.fill(0, e.at, e.at + 12);
    }
    r.w16(gpsAt, 0);
    return { tiff: t, gps: true };
  } catch { return { tiff: Buffer.from(src), gps: false }; }
}
export function tiffHasGps(t) {
  try {
    const r = tiffReader(t);
    const ptr = r && ifdEntries(t, r, r.u32(4)).find(e => e.tag === 0x8825);
    return !!ptr && ifdEntries(t, r, r.u32(ptr.value)).length > 0;
  } catch { return false; }
}
function tiffOrientation(t) {
  try {
    const r = tiffReader(t);
    const e = r && ifdEntries(t, r, r.u32(4)).find(x => x.tag === 0x0112);
    return e ? r.u16(e.value) || null : null;
  } catch { return null; }
}
const EXIF_HEAD = Buffer.from('Exif\0\0');
const unwrapExif = p => (p.subarray(0, 6).equals(EXIF_HEAD) ? p.subarray(6) : p);
function stripGpsExif(payload) {
  const wrapped = payload.subarray(0, 6).equals(EXIF_HEAD);
  const { tiff, gps } = stripGpsTiff(unwrapExif(payload));
  return { payload: wrapped ? Buffer.concat([EXIF_HEAD, tiff]) : tiff, gps };
}

// ---- Format readers ----
function* pngChunks(b) {
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i), typ = b.toString('latin1', i + 4, i + 8), end = i + 12 + len;
    if (end > b.length) throw new Error('truncated PNG chunk');
    yield { typ, data: b.subarray(i + 8, i + 8 + len), raw: b.subarray(i, end) };
    i = end;
    if (typ === 'IEND') break;
  }
}
function pngChunk(typ, data) {
  const t = Buffer.from(typ, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}
function* webpChunks(b) {
  let i = 12;
  while (i + 8 <= b.length) {
    const tag = b.toString('latin1', i, i + 4), size = b.readUInt32LE(i + 4);
    if (i + 8 + size > b.length) throw new Error('truncated WebP chunk');
    yield { tag, payload: b.subarray(i + 8, i + 8 + size) };
    i += 8 + size + (size % 2);
  }
}
const webpChunk = (tag, p) => { const s = Buffer.alloc(4); s.writeUInt32LE(p.length); return Buffer.concat([Buffer.from(tag, 'latin1'), s, p, p.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]); };

function jpegExif(b) {
  try {
    for (const p of splitJpeg(b).parts)
      if (p.marker === 0xe1 && p.seg.subarray(4, 10).equals(EXIF_HEAD)) return p.seg.subarray(10);
  } catch { /* not readable */ }
  return null;
}
function exifOf(b, fmt) {
  try {
    if (fmt === 'jpeg') return jpegExif(b);
    if (fmt === 'png') for (const c of pngChunks(b)) if (c.typ === 'eXIf') return unwrapExif(c.data);
    if (fmt === 'webp') for (const c of webpChunks(b)) if (c.tag === 'EXIF') return unwrapExif(c.payload);
  } catch { /* none */ }
  return null;
}
export function hasGps(b) { const t = exifOf(b, sniff(b)); return !!t && tiffHasGps(t); }
export function orientation(b) { const t = exifOf(b, sniff(b)); return t ? tiffOrientation(t) : null; }

export function size(b) {
  const fmt = sniff(b);
  try {
    if (fmt === 'jpeg') for (const p of splitJpeg(b).parts)
      if (p.marker >= 0xc0 && p.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(p.marker) && p.seg.length >= 9)
        return { width: p.seg.readUInt16BE(7), height: p.seg.readUInt16BE(5), components: p.seg[9] };
    if (fmt === 'png') for (const c of pngChunks(b)) if (c.typ === 'IHDR') return { width: c.data.readUInt32BE(0), height: c.data.readUInt32BE(4), colorType: c.data[9] };
    if (fmt === 'webp') for (const c of webpChunks(b)) {
      if (c.tag === 'VP8X') return { width: c.payload.readUIntLE(4, 3) + 1, height: c.payload.readUIntLE(7, 3) + 1 };
      if (c.tag === 'VP8 ') return { width: c.payload.readUInt16LE(6) & 0x3fff, height: c.payload.readUInt16LE(8) & 0x3fff };
      if (c.tag === 'VP8L') { const bits = c.payload.readUInt32LE(1); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    }
    if (fmt === 'gif') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (fmt === 'bmp') return { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) };
  } catch { /* unknown */ }
  return { width: null, height: null };
}
function colorMode(b, fmt) {
  const s = size(b);
  if (fmt === 'jpeg') return { 1: 'L', 3: 'RGB', 4: 'CMYK' }[s.components] || null;
  if (fmt === 'png') return { 0: 'L', 2: 'RGB', 3: 'P', 4: 'LA', 6: 'RGBA' }[s.colorType] || null;
  return null;
}

// ---- Writers ----
export function prepareJpeg(b, meta) {
  const { parts, tail } = splitJpeg(b);
  const kept = [];
  for (const p of parts) {
    const payload = p.seg.subarray(4);
    if (p.marker === 0xe1 && p.seg.length > 4) {
      if (payload.subarray(0, XMP_NS.length).equals(XMP_NS)) continue;
      if (payload.subarray(0, 6).equals(EXIF_HEAD)) { kept.push({ marker: p.marker, seg: appSeg(0xe1, stripGpsExif(payload).payload) }); continue; }
    }
    if (p.marker === 0xed && p.seg.length > 4 && payload.subarray(0, PS3.length).equals(PS3)) {
      const rest = stripIptc(payload);
      if (rest) kept.push({ marker: p.marker, seg: appSeg(0xed, rest) });
      continue;
    }
    kept.push(p);
  }
  const out = [];
  let i = 0;
  if (kept[0]?.marker === 0xd8) { out.push(kept[0].seg); i = 1; if (kept[1]?.marker === 0xe0) { out.push(kept[1].seg); i = 2; } }
  out.push(appSeg(0xe1, Buffer.concat([XMP_NS, buildXmp(meta)])));
  const iim = iptcIim(meta);
  if (iim.length) out.push(app13(iim));
  for (; i < kept.length; i++) out.push(kept[i].seg);
  return Buffer.concat([...out, tail]);
}

export function preparePng(b, meta) {
  const out = [PNG_SIG];
  for (const c of pngChunks(b)) {
    if (['iTXt', 'tEXt', 'zTXt'].includes(c.typ) && c.data.subarray(0, PNG_XMP_KEY.length + 1).equals(Buffer.concat([PNG_XMP_KEY, Buffer.from([0])]))) continue;
    if (c.typ === 'eXIf') { out.push(pngChunk('eXIf', stripGpsExif(c.data).payload)); continue; }
    if (c.typ === 'IEND') out.push(pngChunk('iTXt', Buffer.concat([PNG_XMP_KEY, Buffer.alloc(5), buildXmp(meta)])));
    out.push(c.raw);
  }
  return Buffer.concat(out);
}

export function prepareWebp(b, meta) {
  const { width, height } = size(b);
  const cleaned = [];
  let vp8x = null, flags = 0;
  for (const c of webpChunks(b)) {
    let p = c.payload;
    if (c.tag === 'XMP ') continue;
    if (c.tag === 'VP8X') { vp8x = p; if (p.length) flags = p[0]; continue; }
    if (c.tag === 'EXIF') { p = stripGpsExif(p).payload; flags |= 0x08; }
    else if (c.tag === 'ICCP') flags |= 0x20;
    else if (c.tag === 'ALPH') flags |= 0x10;
    else if (c.tag === 'ANIM' || c.tag === 'ANMF') flags |= 0x02;
    else if (c.tag === 'VP8L' && p.length >= 5 && p[0] === 0x2f && ((p.readUInt32LE(1) >>> 28) & 1)) flags |= 0x10;
    cleaned.push({ tag: c.tag, payload: p });
  }
  flags |= 0x04;
  let head;
  if (vp8x && vp8x.length >= 10) { head = Buffer.from(vp8x); head[0] = flags; }
  else { head = Buffer.alloc(10); head[0] = flags; head.writeUIntLE(Math.max(1, width || 1) - 1, 4, 3); head.writeUIntLE(Math.max(1, height || 1) - 1, 7, 3); }
  const body = Buffer.concat([webpChunk('VP8X', head), ...cleaned.map(c => webpChunk(c.tag, c.payload)), webpChunk('XMP ', buildXmp(meta))]);
  const riff = Buffer.alloc(4); riff.writeUInt32LE(body.length + 4);
  return Buffer.concat([Buffer.from('RIFF'), riff, Buffer.from('WEBP'), body]);
}

// Uncompressed 24/32-bit BMP to raw RGB (sharp cannot read BMP).
function bmpRaw(b) {
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28), comp = b.readUInt32LE(30);
  if (!(bpp === 24 || bpp === 32) || !(comp === 0 || (comp === 3 && bpp === 32)) || w <= 0 || !hRaw) throw new Error(`BMP ${bpp}-bit (compression ${comp}) is not supported`);
  const h = Math.abs(hRaw), step = bpp / 8, row = Math.ceil((w * step) / 4) * 4, px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const src = off + (hRaw > 0 ? h - 1 - y : y) * row;
    for (let x = 0; x < w; x++) { const s = src + x * step, d = (y * w + x) * 3; px[d] = b[s + 2]; px[d + 1] = b[s + 1]; px[d + 2] = b[s]; }
  }
  return { px, w, h };
}

async function stillToJpeg(b, fmt, meta) {
  const sharp = (await import('sharp')).default;
  let img;
  if (fmt === 'bmp') { const { px, w, h } = bmpRaw(b); img = sharp(px, { raw: { width: w, height: h, channels: 3 } }); }
  else img = sharp(b, { pages: 1 });
  const jpeg = await img.flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  return prepareJpeg(jpeg, meta);
}

async function isAnimated(b, fmt) {
  if (fmt === 'webp') { try { for (const c of webpChunks(b)) if (c.tag === 'ANIM') return true; } catch { /* no */ } return false; }
  if (fmt !== 'gif') return false;
  try { const sharp = (await import('sharp')).default; return ((await sharp(b).metadata()).pages || 1) > 1; } catch { return false; }
}

// Mirrors prepare_wbw_image: { image, format, width, height, converted, converted_from, metadata_written, gps_stripped, orientation, color_mode, warnings }.
export async function prepareWbwImage(source, meta) {
  const src = Buffer.from(source);
  const hadGps = hasGps(src);
  let fmt = sniff(src);
  let { width, height } = size(src);
  let orient = orientation(src), mode = colorMode(src, fmt);
  const warnings = qualityWarnings(src, width, height);
  let out = src, converted = false, convertedFrom = null, written = false;
  if (fmt === 'jpeg') { out = prepareJpeg(src, meta); written = true; }
  else if (fmt === 'png') { out = preparePng(src, meta); written = true; }
  else if (fmt === 'webp') { out = prepareWebp(src, meta); written = true; }
  else if ((fmt === 'gif' || fmt === 'bmp') && !(await isAnimated(src, fmt))) {
    out = await stillToJpeg(src, fmt, meta);
    converted = true; convertedFrom = fmt; written = true;
    warnings.push(`${fmt.toUpperCase()} cannot hold standard XMP; converted to JPEG`);
    fmt = 'jpeg';
    ({ width, height } = size(out));
    orient = orientation(out) || orient; mode = colorMode(out, 'jpeg') || mode;
  } else {
    warnings.push(fmt === 'unknown' ? 'unrecognized format kept as original; metadata was not written'
      : (await isAnimated(src, fmt)) ? `animated ${fmt.toUpperCase()} kept as original; metadata was not written`
        : `${fmt.toUpperCase()} kept as original; metadata was not written`);
  }
  return { image: out, format: fmt, width, height, converted, converted_from: convertedFrom, metadata_written: written,
    gps_stripped: hadGps && !hasGps(out), orientation: orient, color_mode: mode, warnings };
}
