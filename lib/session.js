// Login sessions (cookie "auth", or the extension header x-auth): "admin" for staff, "seller:<name>" for a seller.
// HMAC-SHA256, a 30-day expiry, and a session version. A password change bumps the version and old sessions stop.
// A seller cookie signed with the old "wbwlister" key still reads as version 0 until 2026-11-06.
// Admin cookies from that format are not accepted.
// A bad cookie is not a session. Callers turn that into 401. This file never throws.
const TTL = 30 * 24 * 60 * 60 * 1000;
export const LEGACY_UNTIL = Date.UTC(2026, 10, 6);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let n = 0;
  for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return n === 0;
};
const b64url = s => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlDecode = s => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
const parseWho = who => who === 'admin' ? { role: 'admin' } : typeof who === 'string' && who.startsWith('seller:') && who.length > 7 ? { role: 'seller', seller: who.slice(7) } : null;

export async function sessionToken(who, secret, opt = {}) {
  const now = opt.now ?? Date.now();
  const body = b64url(JSON.stringify({ w: who, e: now + (opt.ttl ?? TTL), v: opt.version ?? 0 }));
  return `bootlister.${body}.${await hmac(`bootlister:${body}`, secret)}`;
}

async function readCurrent(token, secret, now) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  if (!body || !sig || !same(sig, await hmac(`bootlister:${body}`, secret))) return null;
  const data = JSON.parse(b64urlDecode(body));
  if (!data || typeof data.w !== 'string' || typeof data.e !== 'number' || data.e <= now) return null;
  const who = parseWho(data.w);
  return who && { ...who, version: Number(data.v ?? 0) };
}

// One read of a seller cookie signed before the key was renamed. Version 0, so a later password change rejects it.
// Staff cookies in this format are rejected. Seller cookies stop working on 2026-11-06.
async function readLegacy(token, secret, now) {
  const dot = String(token).indexOf('.');
  if (dot < 1 || now >= LEGACY_UNTIL) return null;
  const who = decodeURIComponent(token.slice(0, dot));
  if (!who || !same(token.slice(dot + 1), await sha256(`wbwlister:${secret}:${who}`))) return null;
  const parsed = parseWho(who);
  if (!parsed || parsed.role !== 'seller') return null;
  return { ...parsed, version: 0, legacy: true };
}

export async function readSession(token, secret, now = Date.now()) {
  try {
    if (!token || !secret) return null;
    if (String(token).startsWith('bootlister.')) return await readCurrent(token, secret, now);
    return await readLegacy(token, secret, now);
  } catch { return null; }
}

export const sessionCookie = (token, maxAge = 2592000) => `auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
