// Seller passwords. scrypt (Node crypto) — not the password, and not the session cookie.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 32;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const N = 16384, r = 8, p = 1;
  const hash = (await scryptAsync(String(password), salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 })).toString('hex');
  return { salt, hash: `scrypt$${N}$${r}$${p}$${hash}` };
}

export async function verifyPassword(password, salt, stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([0-9a-f]+)$/i.exec(stored ?? '');
  if (!m || !salt) return false;
  const [, N, r, p, hexHash] = m;
  let got;
  try { got = await scryptAsync(String(password ?? ''), String(salt), KEYLEN, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 }); }
  catch { return false; }
  const want = Buffer.from(hexHash, 'hex');
  if (hexHash.length !== KEYLEN * 2 || want.length !== got.length) return false;
  return timingSafeEqual(got, want);
}

// Fixed-length compare so the admin password check does not leak the length.
export function passwordEqual(given, want) {
  if (!want) return false;
  const a = createHash('sha256').update(String(given ?? '')).digest();
  const b = createHash('sha256').update(String(want)).digest();
  return timingSafeEqual(a, b);
}
