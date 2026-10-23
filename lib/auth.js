// Seller registration (email or phone + password) and the staff admin password.
// The password is scrypt (lib/passwords.js). The admin password is an env var, not a row in the database.
import { adminPassword } from './gate';
import { hashPassword, passwordEqual, verifyPassword } from './passwords';

export const MIN_PASSWORD = 8;
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

// records: { name, email, phone, salt, hash }. A previous PIN (not scrypt) does not count as registered.
export async function registerSeller(records, input) {
  const v = validateRegistration(input);
  if (records.some(r => hasPassword(r) && v.email && normEmail(r.email) === v.email)) throw new Error('That email is already registered.');
  if (records.some(r => hasPassword(r) && v.phone && normPhone(r.phone) === v.phone)) throw new Error('That phone number is already registered.');
  const claim = records.find(r => !hasPassword(r) && v.email && normEmail(r.email) === v.email)
    ?? records.find(r => !hasPassword(r) && v.phone && normPhone(r.phone) === v.phone);
  const { salt, hash } = await hashPassword(v.password);
  let name = claim?.name;
  if (!name) {
    const base = sellerSlug(v.display_name, v.email, v.phone);
    name = base;
    for (let i = 2; records.some(r => r.name === name); i++) {
      if (i > 1000) throw new Error('Could not choose a seller name.');
      name = `${base.slice(0, 36)}-${i}`;
    }
  }
  const row = {
    name, display_name: v.display_name, salt, hash,
    email: v.email ?? (claim ? normEmail(claim.email) || null : null),
    phone: v.phone ?? (claim ? normPhone(claim.phone) || null : null),
  };
  return { row, claim: !!claim };
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
  return ok.length === 1 ? { role: 'seller', seller: ok[0].name } : null;
}

// Staff. The username is the word "admin". A wrong password is null — never a seller session.
export async function matchAdmin(id, password, env = process.env) {
  if (!isAdminId(id)) return null;
  if (!passwordEqual(password, adminPassword(env))) return null;
  return { role: 'admin' };
}

export const sessionWho = who => who.role === 'seller' ? `seller:${who.seller}` : 'admin';
