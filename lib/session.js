// Login sessions (cookie "auth", or the extension header x-auth): "admin" for staff, "seller:<name>" for a seller.
// HMAC-SHA256, a 30-day expiry, and a session version. A password change bumps the version and old sessions stop.
// A bad cookie is not a session. Callers turn that into 401. This file never throws.
const TTL = 30 * 24 * 60 * 60 * 1000;
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

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

export async function readSession(token, secret, now = Date.now()) {
  try {
    if (!token || !secret) return null;
    if (String(token).startsWith('bootlister.')) return await readCurrent(token, secret, now);
    return null;
  } catch { return null; }
}

export const sessionCookie = (token, maxAge = 2592000) => `auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
