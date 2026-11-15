// Validation for the public seller intake form. Temporary passwords never appear in returned objects or error text.
import { isEmail, MIN_PASSWORD, normEmail, normPhone } from './auth';
import { packShopLinks, parseShopLinks, SHOP_CHANNELS } from './seller-links';

import { EMAIL_PREFS, HONEYPOT, INTAKE_LIMITS, MAX_PHOTO_BYTES, USERNAME_RE } from './public-intake-constants';
export { MAX_PHOTO_BYTES, HONEYPOT };

const LABELS = { display_name: 'Display name', phone: 'Phone', location: 'Location', aliases: 'Aliases', bio: 'Bio', fun_fact: 'Fun fact',
  sells_where: 'Where you sell', boot_types: 'Kinds of boots', pairs_estimate: 'Number of pairs', notes: 'Anything else', terms: 'Shorthand', defaults: 'Defaults' };
const text = (input, k) => {
  const v = String(input[k] ?? '').trim();
  if (v.length > INTAKE_LIMITS[k]) throw new Error(`${LABELS[k] || 'A shop link'} is too long (${INTAKE_LIMITS[k]} characters max).`);
  return v;
};
const OPTIONAL_TEXT = ['aliases', 'bio', 'fun_fact', 'sells_where', 'boot_types', 'pairs_estimate', 'notes'];
const on = v => v === true || v === 'on' || v === 'yes' || v === 'true';
export function readEmailPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : null;
  return Object.fromEntries(EMAIL_PREFS.map(([k]) => [k, p && k in p ? on(p[k]) : true]));
}
export const MAX_DB_PHOTO_BYTES = 250 * 1024;
export const INTAKE_LIMIT = 5;
export const INTAKE_WINDOW_MS = 60 * 60 * 1000;

export const clientIp = req => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';

export const isHoneypot = input => String(input?.[HONEYPOT] ?? '').trim() !== '';

export function sniffPhoto(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function readPhoto(input) {
  const raw = input?.photo ?? input?.photo_data;
  if (!raw) return null;
  let buf;
  if (Buffer.isBuffer(raw)) buf = raw;
  else {
    const s = String(raw).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    try { buf = Buffer.from(s, 'base64'); }
    catch { throw new Error('That photo could not be read.'); }
  }
  if (!buf.length) return null;
  if (buf.length > MAX_PHOTO_BYTES) throw new Error('Please use a photo of 5 MB or less.');
  const type = sniffPhoto(buf);
  if (!type) throw new Error('Please use a JPG, PNG, or WebP photo.');
  return { bytes: buf, type };
}

export function validatePublicIntake(input = {}) {
  const display_name = text({ display_name: input.display_name ?? input.name }, 'display_name');
  if (!display_name) throw new Error('Your display name (the name to show on WBW) is required.');
  const username = String(input.username ?? '').trim();
  if (!username) throw new Error('A username is required.');
  if (!USERNAME_RE.test(username)) throw new Error('Username must be 3 to 20 letters, numbers, or underscores.');
  const emailRaw = String(input.email ?? '').trim();
  if (!emailRaw) throw new Error('An email address is required.');
  if (emailRaw.length > INTAKE_LIMITS.email) throw new Error('Email is too long.');
  if (!isEmail(emailRaw)) throw new Error('Email has to look like an email address.');
  const email = normEmail(emailRaw);
  const phoneRaw = text(input, 'phone');
  const phone = phoneRaw ? normPhone(phoneRaw) : '';
  if (phoneRaw && !phone) throw new Error('Phone number needs at least 10 digits.');
  const location = text(input, 'location');
  const channels = Object.fromEntries(SHOP_CHANNELS.map(k => [k, text(input, k)]));
  if (!SHOP_CHANNELS.some(k => channels[k])) throw new Error('Add at least one shop link (Depop, Facebook, eBay, Poshmark, or your website).');
  const password = String(input.password ?? '');
  const confirm = input.password_confirm !== undefined ? String(input.password_confirm ?? '') : password;
  if (password.length < MIN_PASSWORD) throw new Error(`The temporary password needs at least ${MIN_PASSWORD} characters.`);
  if (password.length > 200) throw new Error('The temporary password is too long.');
  if (password !== confirm) throw new Error('The temporary password and confirmation do not match.');
  const photo_ok = input.photo_ok === true || input.photo_ok === 'on' || input.photo_ok === 'yes';
  const import_ok = input.import_ok === true || input.import_ok === 'on' || input.import_ok === 'yes';
  if (!photo_ok) throw new Error('Please confirm you own the photos and allow renaming and optimizing.');
  if (!import_ok) throw new Error('Please confirm we can copy your current listings into BootLister for review.');
  const brand_context = input.brand_context === 'off' ? 'off' : 'on';
  const terms = text(input, 'terms');
  const defaults = text(input, 'defaults');
  const extra = Object.fromEntries(OPTIONAL_TEXT.map(k => [k, text(input, k) || null]));
  const photo = readPhoto(input);
  const links = packShopLinks(channels);
  const code = String(input.code ?? '').trim().slice(0, 200);
  return {
    display_name, username, email, ...extra, email_prefs: readEmailPrefs(input.email_prefs), phone: phone || null, location: location || null,
    ...links, terms: terms || null, defaults: defaults || null, brand_context,
    photo_ok: 'on', import_ok: 'on', photo, code: code || null, password,
  };
}

// Safe object for APIs and logs. Never includes the password or cipher.
export function publicIntakeView(row = {}) {
  const channels = parseShopLinks(row);
  return {
    id: row.id, status: row.status || 'pending',
    display_name: row.display_name, username: row.username ?? null, email: row.email, phone: row.phone, location: row.location,
    ...Object.fromEntries(OPTIONAL_TEXT.map(k => [k, row[k] ?? null])), email_prefs: row.email_prefs ?? null,
    ...channels, shop_links: row.shop_links, website: row.website, fb_profile: row.fb_profile,
    terms: row.terms, defaults: row.defaults, brand_context: row.brand_context ?? 'on',
    photo_ok: row.photo_ok, import_ok: row.import_ok,
    photo_url: row.photo_url || (row.photo_key ? `/img/intake/${row.photo_key}` : null),
    has_password: !!row.password_cipher && !row.password_cleared_at,
    password_cleared_at: row.password_cleared_at || null,
    seller_name: row.seller_name || null,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}
