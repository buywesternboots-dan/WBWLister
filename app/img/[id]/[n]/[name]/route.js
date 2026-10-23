// Public photo URL with an SEO filename: serves the seller's photo unchanged (pixels), with XMP keywords/credit added and long cache.
// Blob URLs are fetched as stored. Source URLs (kept when Blob is full) are fetched http(s)-only, never from a private address.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { getItem } from '../../../../../lib/wbw';
import { withXmp } from '../../../../../lib/seo';

const MAX_BYTES = 15 * 1024 * 1024, TIMEOUT_MS = 15000;
const BLOCKED = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]])
  BLOCKED.addSubnet(net, bits, 'ipv4');
BLOCKED.addAddress('::', 'ipv6');
BLOCKED.addAddress('::1', 'ipv6');
BLOCKED.addSubnet('fe80::', 10, 'ipv6');
BLOCKED.addSubnet('fc00::', 7, 'ipv6');

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

// Fetches one stored source photo. Redirects are checked again. One deadline covers every hop and the body.
export async function readSourcePhoto(src, opt = {}) {
  const doFetch = opt.fetch ?? fetch, doLookup = opt.lookup ?? lookup, maxBytes = opt.maxBytes ?? MAX_BYTES;
  const signal = opt.signal ?? AbortSignal.timeout(opt.timeoutMs ?? TIMEOUT_MS);
  const once = async (target, redirects) => {
    if (redirects > 3) throw new Error('redirects');
    let u;
    try { u = new URL(target); } catch { throw new Error('bad url'); }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new Error('bad url');
    const host = hostOf(u);
    if (!host || blockedName(host)) throw new Error('blocked');
    const ips = isIP(host) ? [host] : (await doLookup(host, { all: true })).map(a => a.address);
    if (!ips.length || ips.some(isBlockedIp)) throw new Error('blocked');
    const res = await doFetch(u.href, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel?.();
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect');
      return once(new URL(loc, u).href, redirects + 1);
    }
    if (!res.ok) throw new Error('http');
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/') || type.includes('svg')) { await res.body?.cancel?.(); throw new Error('type'); }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel?.(); throw new Error('too big'); }
    const chunks = [];
    let size = 0;
    const stream = res.body;
    if (stream?.[Symbol.asyncIterator]) {
      for await (const chunk of stream) {
        const b = Buffer.from(chunk);
        size += b.length;
        if (size > maxBytes) { await stream.cancel?.(); throw new Error('too big'); }
        chunks.push(b);
      }
    } else {
      const b = Buffer.from(await res.arrayBuffer());
      if (b.length > maxBytes) throw new Error('too big');
      chunks.push(b);
    }
    return { body: Buffer.concat(chunks), type };
  };
  return once(src, 0);
}

export async function GET(req, { params }) {
  const { id, n } = await params;
  const item = /^\d+$/.test(id) ? await getItem(id) : null, src = item?.photos[n - 1];
  if (!src) return new Response('Not found', { status: 404 });
  try {
    if (isBlobPhoto(src)) {
      const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) return new Response('Not found', { status: 404 });
      return new Response(withXmp(Buffer.from(await r.arrayBuffer()), item, +n), {
        headers: { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    const { body, type } = await readSourcePhoto(src);
    return new Response(withXmp(body, item, +n), {
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
