// Public photo URL with an SEO filename: serves the seller's photo unchanged (pixels), with XMP keywords/credit added and long cache.
// Blob URLs and source URLs (kept when Blob is full) are fetched http(s)-only, never from a private address, images only.
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { getItem } from '../../../../../lib/wbw';
import { withXmp } from '../../../../../lib/seo';

const MAX_BYTES = 15 * 1024 * 1024, TIMEOUT_MS = 15000;
const BLOCKED = new BlockList();
// Private, loopback, link-local, CGNAT, benchmark, multicast and reserved ranges.
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]])
  BLOCKED.addSubnet(net, bits, 'ipv4');
BLOCKED.addAddress('::', 'ipv6');
BLOCKED.addAddress('::1', 'ipv6');
for (const [net, bits] of [['fe80::', 10], ['fc00::', 7], ['ff00::', 8], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['2001::', 32], ['2001:db8::', 32]])
  BLOCKED.addSubnet(net, bits, 'ipv6');
// Only raster image types are served; anything else (html, svg, xml, ...) is refused.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
// Some hosts label photos as generic binary; those are allowed only if the bytes are a raster image.
const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
// The served type always comes from the bytes, so a mislabeled html/svg file is never served.
export function sniffImage(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 4 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^avi[fs]$/.test(b.toString('latin1', 8, 12))) return 'image/avif';
  return null;
}
export const PHOTO_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'public, max-age=31536000, immutable' };

const hostOf = u => u.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
const blockedName = host => host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');

export function isBlobPhoto(src) {
  try {
    const u = new URL(src), host = hostOf(u);
    return u.protocol === 'https:' && (host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com'));
  } catch { return false; }
}

export function isBlockedIp(ip) {
  let raw = String(ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) raw = mapped[1];
  const kind = isIP(raw);
  if (kind === 4) return BLOCKED.check(raw, 'ipv4');
  if (kind === 6) return BLOCKED.check(raw, 'ipv6');
  return true;
}

// Minimal fetch over node:http(s). `lookup` pins the connection to the addresses already checked, so a second DNS
// answer (rebinding) can't point the request at a private host. Never follows redirects itself.
export function pinnedFetch(url, { headers, signal, lookup: pin } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', headers, signal, lookup: pin }, res => {
      resolve({
        status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: { get: h => { const v = res.headers[h.toLowerCase()]; return v == null ? null : Array.isArray(v) ? v.join(', ') : String(v); } },
        body: Object.assign(res, { cancel: async () => { res.destroy(); } }),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Fetches one stored source photo. Redirects are checked again. One deadline covers every hop and the body.
export async function readSourcePhoto(src, opt = {}) {
  const doFetch = opt.fetch ?? pinnedFetch, doLookup = opt.lookup ?? lookup, maxBytes = opt.maxBytes ?? MAX_BYTES;
  const signal = opt.signal ?? AbortSignal.timeout(opt.timeoutMs ?? TIMEOUT_MS);
  const once = async (target, redirects) => {
    if (redirects > 3) throw new Error('redirects');
    let u;
    try { u = new URL(target); } catch { throw new Error('bad url'); }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new Error('bad url');
    const host = hostOf(u);
    if (!host || blockedName(host)) throw new Error('blocked');
    const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await doLookup(host, { all: true });
    if (!addrs.length || addrs.some(a => isBlockedIp(a.address))) throw new Error('blocked');
    const pin = (_h, o, cb) => (o?.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family));
    const res = await doFetch(u.href, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal, redirect: 'manual', lookup: pin });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel?.();
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect');
      return once(new URL(loc, u).href, redirects + 1);
    }
    if (!res.ok) throw new Error('http');
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type) && !GENERIC_TYPES.has(type)) { await res.body?.cancel?.(); throw new Error('type'); }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel?.(); throw new Error('too big'); }
    const chunks = [];
    let size = 0;
    const stream = res.body;
    if (stream?.[Symbol.asyncIterator]) {
      for await (const chunk of stream) {
        const b = Buffer.from(chunk);
        size += b.length;
        if (size > maxBytes) throw new Error('too big');
        chunks.push(b);
      }
    } else {
      const b = Buffer.from(await res.arrayBuffer());
      if (b.length > maxBytes) throw new Error('too big');
      chunks.push(b);
    }
    const body = Buffer.concat(chunks), sniffed = sniffImage(body);
    if (!sniffed) throw new Error('type');
    return { body, type: sniffed };
  };
  return once(src, 0);
}

export async function GET(req, { params }) {
  const { id, n } = await params;
  const item = /^\d+$/.test(id) ? await getItem(id) : null, src = item?.photos[n - 1];
  if (!src) return new Response('Not found', { status: 404 });
  try {
    // Blob and source photos go through the same checks: public address only, raster image types only, size and time caps.
    const { body, type } = await readSourcePhoto(src);
    return new Response(withXmp(body, item, +n), { headers: { 'Content-Type': type, ...PHOTO_HEADERS } });
  } catch { return new Response('Not found', { status: 404 }); }
}
