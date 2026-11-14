// Validation for the public seller intake form. Temporary passwords never appear in returned objects or error text.
import { isEmail, MIN_PASSWORD, normEmail, normPhone } from './auth';
import { packShopLinks, parseShopLinks, SHOP_CHANNELS } from './seller-links';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_DB_PHOTO_BYTES = 250 * 1024;
export const HONEYPOT = 'company';
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
  const display_name = String(input.display_name ?? input.name ?? '').trim();
  if (!display_name) throw new Error('Your name to show on WBW is required.');
  const emailRaw = String(input.email ?? '').trim();
  if (!emailRaw) throw new Error('An email address is required.');
  if (!isEmail(emailRaw)) throw new Error('Email has to look like an email address.');
  const email = normEmail(emailRaw);
  const phoneRaw = String(input.phone ?? '').trim();
  const phone = phoneRaw ? normPhone(phoneRaw) : '';
  if (phoneRaw && !phone) throw new Error('Phone number needs at least 10 digits.');
  const location = String(input.location ?? '').trim();
  const channels = Object.fromEntries(SHOP_CHANNELS.map(k => [k, String(input[k] ?? '').trim()]));
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
  const terms = String(input.terms ?? '').trim();
  const defaults = String(input.defaults ?? '').trim();
  const photo = readPhoto(input);
  const links = packShopLinks(channels);
  const code = String(input.code ?? '').trim();
  return {
    display_name, email, phone: phone || null, location: location || null,
    ...links, terms: terms || null, defaults: defaults || null, brand_context,
    photo_ok: 'on', import_ok: 'on', photo, code: code || null, password,
  };
}

// Safe object for APIs and logs. Never includes the password or cipher.
export function publicIntakeView(row = {}) {
  const channels = parseShopLinks(row);
  return {
    id: row.id, status: row.status || 'pending',
    display_name: row.display_name, email: row.email, phone: row.phone, location: row.location,
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
