// Lossless XMP read/write for JPEG, PNG, and WebP. Pixels, ICC, CMYK, and scan data are never rewritten.
import { crc32 } from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_XMP = Buffer.from('XML:com.adobe.xmp\0\0\0\0\0');
const JPEG_APP = new Set(Array.from({ length: 16 }, (_, i) => 0xe0 + i));

export function sniffFormat(buf) {
  if (!buf || buf.length < 3) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString() === 'GIF87a' || buf.subarray(0, 6).toString() === 'GIF89a')) return 'gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  return 'unknown';
}

export function contentTypeFor(fmt) {
  return { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[fmt] || 'application/octet-stream';
}

const esc = s => String(s ?? '').replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`);

export function xmpPacket(meta = {}) {
  const kw = (meta.keywords || []).map(k => `<rdf:li>${esc(k)}</rdf:li>`).join('');
  return Buffer.from(
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">'
    + `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(meta.title || '')}</rdf:li></rdf:Alt></dc:title>`
    + `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(meta.description || '')}</rdf:li></rdf:Alt></dc:description>`
    + `<dc:subject><rdf:Bag>${kw}</rdf:Bag></dc:subject>`
    + `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${esc(meta.copyright || 'westernbootworld.com')}</rdf:li></rdf:Alt></dc:rights>`
    + `<photoshop:Credit>${esc(meta.credit || '')}</photoshop:Credit>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
}

export function readXmpFields(buf) {
  const text = Buffer.from(buf || []).toString('utf8');
  const start = text.indexOf('<x:xmpmeta'), end = text.indexOf('</x:xmpmeta>');
  if (start < 0 || end < 0) return {};
  const xml = text.slice(start, end + 12);
  const alt = tag => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*<rdf:Alt>\\s*<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>`));
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  };
  const bag = tag => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*<rdf:Bag>([\\s\\S]*?)</rdf:Bag>`));
    if (!m) return [];
    return [...m[1].matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g)].map(x => x[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  };
  const credit = xml.match(/<photoshop:Credit>([\s\S]*?)<\/photoshop:Credit>/);
  return { title: alt('dc:title'), description: alt('dc:description'), keywords: bag('dc:subject'), copyright: alt('dc:rights'), credit: credit ? credit[1].replace(/<[^>]+>/g, '').trim() : '' };
}

export const xmpComplete = m => !!(m && m.title && m.description && (m.keywords?.length || 0));

export function mergeMeta(existing = {}, fallback = {}) {
  const text = (a, b) => (a != null && String(a).trim() ? a : (b || ''));
  const kws = existing.keywords?.length ? existing.keywords : (fallback.keywords || []);
  return {
    title: text(existing.title, fallback.title),
    description: text(existing.description, fallback.description),
    keywords: kws,
    credit: text(existing.credit, fallback.credit),
    copyright: text(existing.copyright, fallback.copyright) || 'westernbootworld.com',
  };
}

export function countXmpPackets(buf) {
  const text = Buffer.from(buf || []).toString('utf8');
  return (text.match(/<x:xmpmeta/g) || []).length;
}

export function splitJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  const parts = [{ marker: 0xd8, seg: buf.subarray(0, 2) }];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('bad JPEG marker');
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i], start = i - 1;
    i += 1;
    if (marker === 0xda || marker === 0xd9) return { parts, tail: buf.subarray(start) };
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push({ marker, seg: buf.subarray(start, i) }); continue; }
    const seglen = buf.readUInt16BE(i), end = i + seglen;
    parts.push({ marker, seg: buf.subarray(start, end) });
    i = end;
  }
  return { parts, tail: Buffer.alloc(0) };
}

export function jpegScanPayload(buf) {
  const { parts, tail } = splitJpeg(buf);
  return Buffer.concat([...parts.filter(p => !JPEG_APP.has(p.marker) && p.marker !== 0xd8 && p.marker !== 0xfe).map(p => p.seg), tail]);
}

export function jpegIccSegments(buf) {
  return splitJpeg(buf).parts.filter(p => p.marker === 0xe2 && p.seg.subarray(4).toString('latin1').startsWith('ICC_PROFILE\0')).map(p => Buffer.from(p.seg));
}

function appSeg(marker, payload) {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 + marker); head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function writeJpegXmp(buf, meta) {
  const { parts, tail } = splitJpeg(buf);
  const xmp = appSeg(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), xmpPacket(meta)]));
  const kept = parts.filter(p => !(p.marker === 0xe1 && p.seg.subarray(4).toString('latin1').startsWith('http://ns.adobe.com/xap/1.0/\0')));
  const out = [];
  let i = 0;
  if (kept[0]?.marker === 0xd8) { out.push(kept[0].seg); i = 1; }
  if (kept[i]?.marker === 0xe0) { out.push(kept[i].seg); i += 1; }
  out.push(xmp);
  while (i < kept.length) out.push(kept[i++].seg);
  return Buffer.concat([...out, tail]);
}

function pngChunk(type, data) {
  const typ = Buffer.from(type), len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typ, data])) >>> 0);
  return Buffer.concat([len, typ, data, crc]);
}

function* iterPng(buf) {
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i), typ = buf.subarray(i + 4, i + 8).toString('latin1');
    const data = buf.subarray(i + 8, i + 8 + length), raw = buf.subarray(i, i + 12 + length);
    yield { typ, data, raw };
    i += 12 + length;
    if (typ === 'IEND') break;
  }
}

function isPngXmp(typ, data) {
  return (typ === 'iTXt' || typ === 'tEXt' || typ === 'zTXt') && data.toString('latin1').startsWith('XML:com.adobe.xmp\0');
}

function writePngXmp(buf, meta) {
  const xmp = pngChunk('iTXt', Buffer.concat([PNG_XMP, xmpPacket(meta)]));
  const out = [PNG_SIG];
  for (const c of iterPng(buf)) {
    if (isPngXmp(c.typ, c.data)) continue;
    if (c.typ === 'IEND') { out.push(xmp, c.raw); continue; }
    out.push(c.raw);
  }
  return Buffer.concat(out);
}

function* iterWebp(buf) {
  let i = 12;
  while (i + 8 <= buf.length) {
    const tag = buf.subarray(i, i + 4).toString('latin1');
    const size = buf.readUInt32LE(i + 4);
    const payload = buf.subarray(i + 8, i + 8 + size);
    yield { tag, payload };
    i += 8 + size + (size % 2);
  }
}

function webpChunk(tag, payload) {
  const size = Buffer.alloc(4); size.writeUInt32LE(payload.length);
  const pad = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(tag), size, payload, pad]);
}

function rebuildWebp(chunks) {
  const body = Buffer.concat(chunks.map(c => webpChunk(c.tag, c.payload)));
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length + 4);
  return Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WEBP'), body]);
}

function writeWebpXmp(buf, meta) {
  const xmp = xmpPacket(meta);
  const cleaned = [];
  let vp8x = null, flags = 0;
  for (const c of iterWebp(buf)) {
    if (c.tag === 'XMP ') continue;
    if (c.tag === 'VP8X') { vp8x = c.payload; flags = c.payload[0] || 0; continue; }
    if (c.tag === 'ICCP') flags |= 0x20;
    if (c.tag === 'EXIF') flags |= 0x08;
    if (c.tag === 'ALPH') flags |= 0x10;
    if (c.tag === 'ANIM' || c.tag === 'ANMF') flags |= 0x02;
    cleaned.push(c);
  }
  flags |= 0x04;
  const size = imageSize(buf) || { width: 1, height: 1 };
  let payload;
  if (vp8x && vp8x.length >= 10) {
    payload = Buffer.from(vp8x); payload[0] = flags;
  } else {
    payload = Buffer.alloc(10); payload[0] = flags;
    payload.writeUIntLE((size.width || 1) - 1, 4, 3);
    payload.writeUIntLE((size.height || 1) - 1, 7, 3);
  }
  return rebuildWebp([{ tag: 'VP8X', payload }, ...cleaned, { tag: 'XMP ', payload: xmp }]);
}

export function imageSize(buf) {
  const fmt = sniffFormat(buf);
  try {
    if (fmt === 'jpeg') {
      for (const p of splitJpeg(buf).parts) {
        if (p.marker >= 0xc0 && p.marker <= 0xcf && p.marker !== 0xc4 && p.marker !== 0xc8 && p.marker !== 0xcc && p.seg.length >= 9)
          return { width: p.seg.readUInt16BE(7), height: p.seg.readUInt16BE(5) };
      }
    }
    if (fmt === 'png') {
      for (const c of iterPng(buf)) if (c.typ === 'IHDR' && c.data.length >= 8)
        return { width: c.data.readUInt32BE(0), height: c.data.readUInt32BE(4) };
    }
    if (fmt === 'webp') {
      for (const c of iterWebp(buf)) {
        if (c.tag === 'VP8X' && c.payload.length >= 10)
          return { width: c.payload.readUIntLE(4, 3) + 1, height: c.payload.readUIntLE(7, 3) + 1 };
        if (c.tag === 'VP8 ' && c.payload.length >= 10) {
          const w = c.payload.readUInt16LE(6) & 0x3fff, h = c.payload.readUInt16LE(8) & 0x3fff;
          if (w && h) return { width: w, height: h };
        }
      }
    }
  } catch { /* fall through */ }
  return null;
}

export function writeXmp(buf, meta) {
  const fmt = sniffFormat(buf);
  if (fmt === 'jpeg') return writeJpegXmp(buf, meta);
  if (fmt === 'png') return writePngXmp(buf, meta);
  if (fmt === 'webp') return writeWebpXmp(buf, meta);
  return Buffer.from(buf);
}

// Prefer fields already in the file (amcasoWBW). Only fill blanks from fallback. Never add a second packet.
export function withMergedXmp(buf, fallback = {}) {
  const existing = readXmpFields(buf);
  if (xmpComplete(existing) && countXmpPackets(buf) === 1) return Buffer.from(buf);
  return writeXmp(buf, mergeMeta(existing, fallback));
}
