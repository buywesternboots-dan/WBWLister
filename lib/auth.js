// Seller registration (email or phone + password) and the staff admin password.
// The password is scrypt (lib/passwords.js). The admin password is an env var, not a row in the database.
// Self-registration never takes over a seller row that already exists. An admin sets the first password,
// or issues a one-time invite code (stored as a hash, with an expiry). Nothing is emailed or texted.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { adminPassword } from './gate';
import { hashPassword, passwordEqual, verifyPassword } from './passwords';

export const MIN_PASSWORD = 8;
export const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
export const normEmail = s => String(s ?? '').trim().toLowerCase();
export const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(s));
export const isAdminId = s => /^admin$/i.test(String(s ?? '').trim());

// US 10-digit numbers gain +1. Anything else with 10–15 digits keeps a leading +.
export function normPhone(s) {
  const d = String(s ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (d.length >= 10 && d.length <= 15) return `+${d}`;
  return '';
}

// What the person typed in the sign-in box. "admin" is the staff username, not a seller id.
export function loginId(raw) {
  const s = String(raw ?? '').trim();
  if (!s || isAdminId(s)) return null;
  if (isEmail(s)) return { kind: 'email', value: normEmail(s) };
  const phone = normPhone(s);
  return phone ? { kind: 'phone', value: phone } : null;
}

const hasPassword = r => String(r?.hash ?? '').startsWith('scrypt$');

export function sellerSlug(display, email, phone) {
  const fromName = String(display ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fromEmail = email ? email.split('@')[0].replace(/[^a-z0-9]+/g, '') : '';
  return (fromName || fromEmail || (phone ? phone.replace(/\D/g, '') : '') || 'seller').slice(0, 40);
}

export function validateRegistration(input) {
  const emailRaw = String(input?.email ?? '').trim(), phoneRaw = String(input?.phone ?? '').trim();
  const email = emailRaw ? normEmail(emailRaw) : '', phone = phoneRaw ? normPhone(phoneRaw) : '';
  if (emailRaw && !isEmail(email)) throw new Error('Email has to look like an email address.');
  if (phoneRaw && !phone) throw new Error('Phone number needs at least 10 digits.');
  if (!email && !phone) throw new Error('Add an email or a phone number.');
  const password = String(input?.password ?? '');
  if (password.length < MIN_PASSWORD) throw new Error(`Password needs at least ${MIN_PASSWORD} characters.`);
  if (password.length > 200) throw new Error('Password is too long.');
  const display_name = String(input?.display_name ?? '').trim();
  if (!display_name) throw new Error('Shop name is required.');
  return { email: email || null, phone: phone || null, password, display_name };
}

// records: { name, email, phone, salt, hash }. An existing email or phone is never claimed here, even with no password.
export async function registerSeller(records, input) {
  const v = validateRegistration(input);
  if (records.some(r => v.email && normEmail(r.email) === v.email)) throw new Error('That email is already on a seller. An admin sets the password or an invite.');
  if (records.some(r => v.phone && normPhone(r.phone) === v.phone)) throw new Error('That phone number is already on a seller. An admin sets the password or an invite.');
  const { salt, hash } = await hashPassword(v.password);
  const base = sellerSlug(v.display_name, v.email, v.phone);
  let name = base;
  for (let i = 2; records.some(r => r.name === name); i++) {
    if (i > 1000) throw new Error('Could not choose a seller name.');
    name = `${base.slice(0, 36)}-${i}`;
  }
  return { row: { name, display_name: v.display_name, salt, hash, email: v.email, phone: v.phone, session_v: 0 }, claim: false };
}

export function inviteHash(code) {
  return createHash('sha256').update(String(code ?? '')).digest('hex');
}
export function newInvite(now = Date.now()) {
  const code = randomBytes(24).toString('base64url');
  return { code, hash: inviteHash(code), expires: new Date(now + INVITE_MS).toISOString() };
}
export function inviteMatches(code, hash) {
  if (!/^[0-9a-f]{64}$/i.test(String(hash ?? ''))) return false;
  const got = createHash('sha256').update(String(code ?? '')).digest();
  const want = Buffer.from(String(hash), 'hex');
  return want.length === got.length && timingSafeEqual(got, want);
}
export function assertInvite(record, code, now = Date.now()) {
  if (!record?.invite_hash || !inviteMatches(code, record.invite_hash)) throw new Error('That invite is not valid.');
  if (!record.invite_expires || new Date(record.invite_expires).getTime() <= now) throw new Error('That invite has expired.');
  return record;
}
// Sets a password and bumps the session version, which logs out older sessions. Clears any invite.
export function applyPassword(record, creds) {
  return { ...record, salt: creds.salt, hash: creds.hash, session_v: Number(record?.session_v ?? 0) + 1, invite_hash: null, invite_expires: null };
}
// One-time: a second call with the same code fails because the hash is cleared.
export async function claimWithInvite(records, code, password, now = Date.now()) {
  const passwordStr = String(password ?? '');
  if (passwordStr.length < MIN_PASSWORD) throw new Error(`Password needs at least ${MIN_PASSWORD} characters.`);
  if (passwordStr.length > 200) throw new Error('Password is too long.');
  const i = records.findIndex(r => r.invite_hash && inviteMatches(code, r.invite_hash));
  if (i < 0) throw new Error('That invite is not valid.');
  assertInvite(records[i], code, now);
  const next = applyPassword(records[i], await hashPassword(passwordStr));
  records[i] = next;
  return next;
}

let dummy;
const burn = async password => {
  dummy ??= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummy.salt, dummy.hash);
};

// One matching seller. Two password matches for the same email or phone is treated as a failure.
export async function matchSeller(records, id, password) {
  const key = loginId(id);
  const pw = String(password ?? '');
  if (!key || !pw) return null;
  const hits = records.filter(r => hasPassword(r) && (key.kind === 'email' ? normEmail(r.email) === key.value : normPhone(r.phone) === key.value));
  const ok = [];
  for (const r of hits) if (await verifyPassword(pw, r.salt, r.hash)) ok.push(r);
  if (!ok.length) { await burn(pw); return null; }
  return ok.length === 1 ? { role: 'seller', seller: ok[0].name, version: Number(ok[0].session_v ?? 0) } : null;
}

// Staff. The username is the word "admin". A wrong password is null — never a seller session.
export async function matchAdmin(id, password, env = process.env) {
  if (!isAdminId(id)) return null;
  if (!passwordEqual(password, adminPassword(env))) return null;
  return { role: 'admin' };
}

export const sessionWho = who => who.role === 'seller' ? `seller:${who.seller}` : 'admin';
