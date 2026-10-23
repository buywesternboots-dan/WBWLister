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
    return false;
  }
  const p = raw.split('.').map(n => Number(n));
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
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

export function allowedPhotoUrl(src, env = process.env) {
  let u;
  try { u = new URL(src); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com')) return true;
  const base = String(env.R2_PUBLIC_BASE ?? '').trim();
  if (!base) return false;
  try { return host === new URL(base.includes('://') ? base : `https://${base}`).hostname.toLowerCase(); }
  catch { return false; }
}

export function imageType(contentType) {
  const ct = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!ct.startsWith('image/')) throw new Error('Photo was not an image.');
  return ct;
}

// GET url. Redirects are checked again. image: true requires an image content-type.
export async function safeFetch(url, opt = {}) {
  const maxBytes = opt.maxBytes ?? MAX_BYTES, timeout = opt.timeout ?? TIMEOUT;
  const once = async (target, redirects) => {
    if (redirects > 4) throw new Error('Too many redirects.');
    let u;
    try { u = new URL(target); } catch { throw new Error('Bad URL.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.');
    if (u.username || u.password) throw new Error('That address is not allowed.');
    const ips = await (opt.resolve ?? resolvePublic)(u.hostname);
    if (ips.some(isPrivateAddress)) throw new Error('That address is not allowed.');
    const lib = u.protocol === 'https:' ? https : http;
    const ip = ips[0];
    const res = await new Promise((resolve, reject) => {
      const req = lib.request({
        host: ip, family: isIP(ip), servername: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}` || '/',
        method: 'GET', timeout, rejectUnauthorized: true,
        headers: { Host: u.host, 'User-Agent': 'BootLister', Accept: opt.image ? 'image/*' : '*/*' },
      }, resolve);
      req.on('timeout', () => { req.destroy(); reject(new Error('The request timed out.')); });
      req.on('error', reject);
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
