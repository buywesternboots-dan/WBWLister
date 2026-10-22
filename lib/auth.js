// Email + PIN sign-in. Low security on purpose: any non-empty PIN, no 2FA. The PIN is never stored — only a salted SHA-256.
// APP_PASSWORD is not a PIN; it only signs the session (lib/session.js).
import { sha256 } from './session';

export const normEmail = s => String(s ?? '').trim().toLowerCase();
export const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(s));
export const pinHash = (salt, pin) => sha256(`${salt}:${String(pin ?? '').trim()}`);

export async function newPinRecord(pin) {
  const salt = crypto.randomUUID();
  return { salt, hash: await pinHash(salt, pin) };
}

// Cookie/token payload. Team stays "admin" so the proxy keeps treating that session as the full tool.
export const sessionWho = who => who.role === 'seller' ? `seller:${who.seller}` : 'admin';

// records: { email, role: 'team'|'seller', seller?, salt, hash }.
// One matching hash wins. Two sellers with the same email and the same PIN is ambiguous → null (same as a wrong PIN).
// A matching team row wins over a seller row for that email.
export async function matchLogin(email, pin, records) {
  const e = normEmail(email), p = String(pin ?? '').trim();
  if (!isEmail(e) || !p) return null;
  const hits = [];
  for (const r of records)
    if (normEmail(r.email) === e && r.salt && r.hash && r.hash === await pinHash(r.salt, p)) hits.push(r);
  if (hits.some(r => r.role === 'team')) return { role: 'team' };
  const sellers = hits.filter(r => r.role === 'seller' && r.seller);
  return sellers.length === 1 ? { role: 'seller', seller: sellers[0].seller } : null;
}
