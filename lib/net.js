// Outbound fetches: http(s) only, no private, loopback, or link-local addresses, with a timeout and a size cap.
// Photos must be an image. Our own Blob and R2 URLs are recognized by hostname, not by a substring of the URL.
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT = 20000;

// Eight hextets, or null when the address is not a plain IPv6 literal. Unparseable stays blocked.
const expandV6 = raw => {
  const sides = raw.split('::');
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(':') : [], right = sides.length === 2 ? (sides[1] ? sides[1].split(':') : []) : [];
  if (sides.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some(p => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map(p => parseInt(p, 16));
};

export function isPrivateAddress(ip) {
  const raw = String(ip ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!raw) return true;
  if (raw.includes(':')) {
    const dotted = raw.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const p = expandV6(raw);
    if (!p) return true;
    // Node writes ::ffff:127.0.0.1 as ::ffff:7f00:1. Check the embedded IPv4.
    if (p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 0 && p[4] === 0 && p[5] === 0xffff)
      return isPrivateAddress(`${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`);
    if (p.every(n => n === 0) || (p[7] === 1 && p.slice(0, 7).every(n => n === 0))) return true;
    if ((p[0] & 0xffc0) === 0xfe80 || (p[0] & 0xfe00) === 0xfc00) return true;
    if ((p[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  const p = raw.split('.').map(n => Number(n));
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224 && a <= 239) return true; // multicast
  return false;
}

const blockedName = host => {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h === 'localhost.localdomain' || h.endsWith('.localhost') || h.endsWith('.local');
};

export async function resolvePublic(host) {
  const name = String(host ?? '').replace(/^\[|\]$/g, '');
  if (!name || blockedName(name)) throw new Error('That address is not allowed.');
  const ips = isIP(name) ? [name] : (await lookup(name, { all: true, verbatim: true })).map(a => a.address);
  if (!ips.length || ips.some(isPrivateAddress)) throw new Error('That address is not allowed.');
  return ips;
}

const hostOf = value => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try { return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase(); }
  catch { return ''; }
};

// Our Blob store only. The store id is the fourth part of BLOB_READ_WRITE_TOKEN (vercel_blob_rw_<id>_…).
export function blobPublicHost(env = process.env) {
  const storeId = String(env.BLOB_READ_WRITE_TOKEN ?? '').split('_')[3] ?? '';
  return /^[a-z0-9]+$/i.test(storeId) ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : '';
}

export function allowedPhotoUrl(src, env = process.env) {
  let u;
  try { u = new URL(src); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  const ours = [blobPublicHost(env), hostOf(env.BLOB_PUBLIC_HOST), hostOf(env.R2_PUBLIC_BASE_URL)];
  return ours.some(h => h && h === host);
}

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
export function imageType(contentType) {
  let ct = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (ct === 'image/jpg') ct = 'image/jpeg';
  if (ct === 'image/svg+xml' || !PHOTO_TYPES.has(ct)) throw new Error('Photo was not an image.');
  return ct;
}

const timedOut = () => new Error('The request timed out.');

// GET url. Redirects are checked again. One deadline covers DNS, every redirect, and the body.
// image: true requires an allowlisted image content-type (no SVG).
export async function safeFetch(url, opt = {}) {
  const maxBytes = opt.maxBytes ?? MAX_BYTES, timeout = opt.timeout ?? TIMEOUT;
  const signal = AbortSignal.timeout(timeout);
  const once = async (target, redirects) => {
    if (signal.aborted) throw timedOut();
    if (redirects > 4) throw new Error('Too many redirects.');
    let u;
    try { u = new URL(target); } catch { throw new Error('Bad URL.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
    if (u.username || u.password) throw new Error('That address is not allowed.');
    const ips = await Promise.race([
      (opt.resolve ?? resolvePublic)(u.hostname),
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(timedOut()), { once: true })),
    ]);
    if (ips.some(isPrivateAddress)) throw new Error('That address is not allowed.');
    const lib = u.protocol === 'https:' ? https : http;
    const ip = ips[0];
    const res = await new Promise((resolve, reject) => {
      if (signal.aborted) return reject(timedOut());
      const req = lib.request({
        host: ip, family: isIP(ip), servername: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}` || '/',
        method: 'GET', signal, rejectUnauthorized: true,
        headers: { Host: u.host, 'User-Agent': 'BootLister', Accept: opt.image ? 'image/*' : '*/*' },
      }, resolve);
      const stop = () => { req.destroy(); reject(timedOut()); };
      signal.addEventListener('abort', stop, { once: true });
      req.on('error', e => reject(signal.aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError' ? timedOut() : e));
      req.end();
    });
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return once(new URL(res.headers.location, u).href, redirects + 1);
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) { res.resume(); throw new Error('File is too large.'); }
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const stop = () => { res.destroy(); reject(timedOut()); };
      if (signal.aborted) return stop();
      signal.addEventListener('abort', stop, { once: true });
      res.on('data', c => {
        size += c.length;
        if (size > maxBytes) { res.destroy(); reject(new Error('File is too large.')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`HTTP ${res.statusCode}`);
    const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (opt.image) imageType(contentType);
    return { status: res.statusCode, contentType, body, text: body.toString('utf8') };
  };
  return once(url, 0);
}
