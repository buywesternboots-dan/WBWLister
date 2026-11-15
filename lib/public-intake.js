// Validation for the public seller intake form. Temporary passwords never appear in returned objects or error text.
import { isEmail, MIN_PASSWORD, normEmail, normPhone } from './auth';
import { packShopLinks, parseShopLinks, SHOP_CHANNELS } from './seller-links';

import { EMAIL_PREFS, HONEYPOT, IMPORT_MODES, INTAKE_LIMITS, PAYMENT_METHODS, MAX_PHOTO_BYTES, USERNAME_RE } from './public-intake-constants';
export { MAX_PHOTO_BYTES, HONEYPOT };

const LABELS = { display_name: 'Display name', phone: 'Phone', location: 'Location', aliases: 'Aliases', bio: 'Bio', fun_fact: 'Fun fact',
  sells_where: 'Where you sell', boot_types: 'Kinds of boots', pairs_estimate: 'Number of pairs', notes: 'Anything else', terms: 'Shorthand', defaults: 'Defaults', pricing_notes: 'Pricing notes', shipping_policy: 'Shipping policy', return_policy: 'Return policy', payment_other: 'Other payment method' };
const text = (input, k) => {
  const v = String(input[k] ?? '').trim();
  if (v.length > INTAKE_LIMITS[k]) throw new Error(`${LABELS[k] || 'A shop link'} is too long (${INTAKE_LIMITS[k]} characters max).`);
  return v;
};
const OPTIONAL_TEXT = ['aliases', 'bio', 'fun_fact', 'sells_where', 'boot_types', 'pairs_estimate', 'notes'];
// Email and/or username for the public account check. Normalized; nothing else is read.
export function readCheckQuery(params) {
  const emailRaw = String(params.get('email') ?? '').trim();
  const usernameRaw = String(params.get('username') ?? '').trim();
  if (!emailRaw && !usernameRaw) throw new Error('Enter an email or username to check.');
  if (emailRaw && (emailRaw.length > INTAKE_LIMITS.email || !isEmail(emailRaw))) throw new Error('Email has to look like an email address.');
  if (usernameRaw && !USERNAME_RE.test(usernameRaw)) throw new Error('Username must be 3 to 20 letters, numbers, or underscores.');
  return { email: emailRaw ? normEmail(emailRaw) : null, username: usernameRaw ? usernameRaw.toLowerCase() : null };
}
function readPayment(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const picked = Array.isArray(p.methods) ? p.methods.map(String) : [];
  const methods = PAYMENT_METHODS.map(([k]) => k).filter(k => picked.includes(k));
  if (!methods.length) return null;
  const other = methods.includes('other') ? text({ payment_other: p.other }, 'payment_other') : '';
  return { methods, other: other || null };
}
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
  const wbw = String(input.has_wbw_account ?? '').trim().toLowerCase();
  if (!['yes', 'no', 'true', 'false'].includes(wbw)) throw new Error('Please tell us whether you already have a Western Boot World account.');
  const has_wbw_account = wbw === 'yes' || wbw === 'true';
  // Existing WBW account: we link it, so no temporary password is collected.
  const password = has_wbw_account ? null : String(input.password ?? '');
  if (password !== null && password.length < MIN_PASSWORD) throw new Error(`The temporary password needs at least ${MIN_PASSWORD} characters.`);
  if (password !== null && password.length > 200) throw new Error('The temporary password is too long.');
  const import_mode = String(input.import_mode ?? '').trim();
  if (!IMPORT_MODES.some(([k]) => k === import_mode)) throw new Error('Please choose how we should import your listings to Western Boot World (live or as drafts).');
  const brand_context = input.brand_context === 'off' ? 'off' : 'on';
  const terms = text(input, 'terms');
  const defaults = text(input, 'defaults');
  const extra = Object.fromEntries(OPTIONAL_TEXT.map(k => [k, text(input, k) || null]));
  const pricing_change = String(input.pricing_change ?? '').trim() || null;
  if (pricing_change && !['yes', 'no'].includes(pricing_change)) throw new Error('Please answer the pricing question with yes or no.');
  const pricing_notes = text(input, 'pricing_notes');
  const policies = {
    pricing_change, pricing_notes: pricing_change === 'yes' ? pricing_notes || null : null,
    shipping_policy: text(input, 'shipping_policy') || null, return_policy: text(input, 'return_policy') || null,
    payment_methods: readPayment(input.payment_methods),
  };
  const photo = readPhoto(input);
  const links = packShopLinks(channels);
  const code = String(input.code ?? '').trim().slice(0, 200);
  return {
    display_name, username, email, ...extra, email_prefs: readEmailPrefs(input.email_prefs), phone: phone || null, location: location || null,
    ...links, terms: terms || null, defaults: defaults || null, brand_context,
    photo_ok: null, import_ok: null, import_mode, has_wbw_account, ...policies, photo, code: code || null, password,
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
    photo_ok: row.photo_ok, import_ok: row.import_ok, import_mode: row.import_mode ?? null, has_wbw_account: row.has_wbw_account ?? null,
    terms_url: row.terms_token ? `/terms/accept/${row.terms_token}` : null,
    terms_sent_at: row.terms_sent_at ?? null, terms_accepted_at: row.terms_accepted_at ?? null, terms_accepted_name: row.terms_accepted_name ?? null,
    ...Object.fromEntries(['pricing_change', 'pricing_notes', 'shipping_policy', 'payment_methods', 'return_policy'].map(k => [k, row[k] ?? null])),
    photo_url: row.photo_url || (row.photo_key ? `/img/intake/${row.photo_key}` : null),
    has_password: !!row.password_cipher && !row.password_cleared_at,
    password_cleared_at: row.password_cleared_at || null,
    seller_name: row.seller_name || null,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}
