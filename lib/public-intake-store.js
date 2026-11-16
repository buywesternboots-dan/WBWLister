// Seller intake sheet: an open form at /intake (Dan often fills it in on the phone). Additive tables only. Temporary passwords stay encrypted.
// Submit stores the sheet and creates the BootLister seller right away (idempotent).
import { randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { HttpError } from './http';
import { DUPLICATE_MESSAGES } from './public-intake-constants';
import { encryptSecret } from './intake-crypto';
import { payLabel } from './wbw-account';
import { INTAKE_LIMIT, INTAKE_WINDOW_MS, MAX_DB_PHOTO_BYTES, publicIntakeView, validatePublicIntake } from './public-intake';

let db;
let ready;
const conn = () => db ??= neon(process.env.DATABASE_URL);
const sql = (...a) => conn()(...a);
export function useIntakeSql(client) {
  db = client;
  ready = null;
}

export function ensureIntakeTables() {
  return ready ??= (async () => {
    const q = conn();
    await q`create table if not exists seller_intake (
      id serial primary key,
      status text not null default 'pending',
      display_name text not null default '',
      email text,
      phone text,
      location text,
      website text,
      fb_profile text,
      shop_links text,
      terms text,
      defaults text,
      brand_context text,
      photo_ok text,
      import_ok text,
      photo_url text,
      photo_bytes bytea,
      photo_type text,
      photo_key text unique,
      password_cipher text,
      password_cleared_at timestamptz,
      invite_hash text,
      invite_expires timestamptz,
      seller_name text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )`;
    await q`create table if not exists intake_password_audit (
      id serial primary key,
      intake_id int not null,
      action text not null,
      actor text not null,
      at timestamptz not null default now()
    )`;
    await q`create table if not exists intake_limits (
      key text primary key,
      n int not null,
      window_start timestamptz not null
    )`;
    await q`alter table sellers add column if not exists profile_photo text`;
    // Intake v2 profile fields. Additive and idempotent.
    await q`alter table seller_intake add column if not exists username text, add column if not exists aliases text,
      add column if not exists bio text, add column if not exists fun_fact text, add column if not exists sells_where text,
      add column if not exists boot_types text, add column if not exists pairs_estimate text, add column if not exists notes text,
      add column if not exists email_prefs jsonb, add column if not exists import_mode text, add column if not exists has_wbw_account boolean`;
    await q`alter table seller_intake add column if not exists pricing_change text, add column if not exists pricing_notes text,
      add column if not exists shipping_policy text, add column if not exists payment_methods jsonb, add column if not exists return_policy text,
      add column if not exists reviewed_at timestamptz`;
    await q`alter table seller_intake add column if not exists sells_belts boolean, add column if not exists measurement_method text,
      add column if not exists encyclopedia_help boolean, add column if not exists encyclopedia_permission boolean,
      add column if not exists price_change_frequency text`;
    await q`create index if not exists seller_intake_email_idx on seller_intake (lower(email))`;
    await q`create index if not exists seller_intake_status_idx on seller_intake (status, created_at desc)`;
  })().catch(e => { ready = null; throw e; });
}

async function storePhoto(photo, env = process.env) {
  if (!photo?.bytes) return {};
  if (env.BLOB_READ_WRITE_TOKEN) {
    try {
      const stored = await put(`intake/${randomBytes(16).toString('hex')}.jpg`, photo.bytes, {
        access: 'public', contentType: photo.type || 'image/jpeg',
      });
      return { photo_url: stored.url, photo_bytes: null, photo_type: null, photo_key: null };
    } catch { /* fall through to database storage */ }
  }
  if (photo.bytes.length > MAX_DB_PHOTO_BYTES) throw new Error('Please use a smaller profile photo (resize it first).');
  return { photo_url: null, photo_bytes: photo.bytes, photo_type: photo.type, photo_key: randomBytes(16).toString('hex') };
}

const rowFields = v => ({
  display_name: v.display_name, email: v.email, phone: v.phone, location: v.location,
  website: v.website, fb_profile: v.fb_profile, shop_links: v.shop_links,
  terms: v.terms, defaults: v.defaults, brand_context: v.brand_context,
  photo_ok: v.photo_ok, import_ok: v.import_ok, import_mode: v.import_mode, has_wbw_account: v.has_wbw_account,
  sells_belts: v.sells_belts, measurement_method: v.measurement_method,
  encyclopedia_help: v.encyclopedia_help, encyclopedia_permission: v.encyclopedia_permission, price_change_frequency: v.price_change_frequency,
  pricing_change: v.pricing_change, pricing_notes: v.pricing_notes, shipping_policy: v.shipping_policy,
  payment_methods: v.payment_methods ? JSON.stringify(v.payment_methods) : null, return_policy: v.return_policy,
  username: v.username, aliases: v.aliases, bio: v.bio, fun_fact: v.fun_fact, sells_where: v.sells_where,
  boot_types: v.boot_types, pairs_estimate: v.pairs_estimate, notes: v.notes, email_prefs: JSON.stringify(v.email_prefs),
});

// 'seller' if the email or username is an existing BootLister seller, 'intake' if an earlier submission used it, else 'none'.
export async function admitIntakeLimit(key, max = INTAKE_LIMIT, windowMs = INTAKE_WINDOW_MS) {
  await ensureIntakeTables();
  const secs = Math.max(1, Math.floor(windowMs / 1000));
  const cap = Math.max(1, Math.floor(Number(max) || INTAKE_LIMIT));
  const rows = await sql`insert into intake_limits (key, n, window_start)
    values (${key}, 1, now())
    on conflict (key) do update set
      n = case
        when intake_limits.window_start <= now() - make_interval(secs => ${secs}) then 1
        else intake_limits.n + 1
      end,
      window_start = case
        when intake_limits.window_start <= now() - make_interval(secs => ${secs}) then now()
        else intake_limits.window_start
      end
    where intake_limits.window_start <= now() - make_interval(secs => ${secs})
       or intake_limits.n < ${cap}
    returning n`;
  return { ok: rows.length > 0, n: rows[0]?.n ?? cap };
}

export async function checkIntakeAccount({ email, username }) {
  await ensureIntakeTables();
  const e = email ? String(email).toLowerCase() : null;
  const u = username ? String(username).toLowerCase() : null;
  const [s] = await sql`select 1 from sellers where (${e}::text is not null and lower(email) = ${e}) or (${u}::text is not null and lower(name) = ${u}) limit 1`;
  if (s) return 'seller';
  const [i] = await sql`select 1 from seller_intake where (${e}::text is not null and lower(email) = ${e}) or (${u}::text is not null and lower(username) = ${u}) limit 1`;
  return i ? 'intake' : 'none';
}

export async function submitPublicIntake(input, { env = process.env, save } = {}) {
  await ensureIntakeTables();
  const v = validatePublicIntake(input);
  const dup = await checkIntakeAccount(v);
  if (dup !== 'none') throw new HttpError(DUPLICATE_MESSAGES[dup], 409);
  const cipher = v.password ? encryptSecret(v.password, env) : null;
  const photo = await storePhoto(v.photo, env);
  const fields = { ...rowFields(v), password_cipher: cipher, ...photo };
  const [row] = await sql`insert into seller_intake (
    status, display_name, email, phone, location, website, fb_profile, shop_links, terms, defaults, brand_context,
    photo_ok, import_ok, photo_url, photo_bytes, photo_type, photo_key, password_cipher,
    username, aliases, bio, fun_fact, sells_where, boot_types, pairs_estimate, notes, email_prefs, import_mode, has_wbw_account,
    pricing_change, pricing_notes, shipping_policy, payment_methods, return_policy,
    sells_belts, measurement_method, encyclopedia_help, encyclopedia_permission, price_change_frequency)
    values ('pending', ${fields.display_name}, ${fields.email}, ${fields.phone}, ${fields.location}, ${fields.website}, ${fields.fb_profile},
      ${fields.shop_links}, ${fields.terms}, ${fields.defaults}, ${fields.brand_context}, ${fields.photo_ok}, ${fields.import_ok},
      ${fields.photo_url}, ${fields.photo_bytes}, ${fields.photo_type}, ${fields.photo_key}, ${fields.password_cipher},
      ${fields.username}, ${fields.aliases}, ${fields.bio}, ${fields.fun_fact}, ${fields.sells_where}, ${fields.boot_types},
      ${fields.pairs_estimate}, ${fields.notes}, ${fields.email_prefs}::jsonb, ${fields.import_mode}, ${fields.has_wbw_account},
      ${fields.pricing_change}, ${fields.pricing_notes}, ${fields.shipping_policy}, ${fields.payment_methods}::jsonb, ${fields.return_policy},
      ${fields.sells_belts}, ${fields.measurement_method}, ${fields.encyclopedia_help}, ${fields.encyclopedia_permission}, ${fields.price_change_frequency})
    returning *`;
  // No review step: create (or link) the BootLister seller now.
  const out = await createSellerFromIntake(row.id, { save, row });
  return { ok: true, id: row.id, seller_name: out.seller_name };
}

export async function listIntakeSubmissions() {
  await ensureIntakeTables();
  const rows = await sql`select id, status, display_name, email, phone, location, website, fb_profile, shop_links, terms, defaults,
    brand_context, photo_ok, import_ok, photo_url, photo_key, password_cipher, password_cleared_at, seller_name, created_at, updated_at,
    username, aliases, bio, fun_fact, sells_where, boot_types, pairs_estimate, notes, email_prefs, import_mode, has_wbw_account,
    pricing_change, pricing_notes, shipping_policy, payment_methods, return_policy, reviewed_at,
    sells_belts, measurement_method,
    encyclopedia_help, encyclopedia_permission, price_change_frequency
    from seller_intake where email is not null order by created_at desc, id desc`;
  return rows.map(publicIntakeView);
}

// Creates (or links) the BootLister seller from the intake data.
// Idempotent: a row already linked to a seller, or an email that already belongs to a seller, never creates a second seller.
// The temporary password is for WBW registration only; it is not set as a BootLister login.
export async function approveIntakeSeller(row, save) {
  const sellers = await sql`select name, email from sellers`;
  if (row.seller_name && sellers.some(s => s.name === row.seller_name)) return row.seller_name;
  const email = String(row.email || '').toLowerCase();
  const same = email && sellers.find(s => String(s.email || '').toLowerCase() === email);
  if (same) return same.name;
  if (!row.display_name || !row.email) throw new Error('This application is missing a name or email.');
  const want = String(row.username || row.display_name).toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'seller';
  let name = want;
  for (let i = 2; sellers.some(s => s.name === name); i++) name = `${want.slice(0, 36)}-${i}`;
  const saved = await save({
    name, display_name: row.display_name, email: row.email, phone: row.phone || '', location: row.location || '',
    website: row.website || '', fb_profile: row.fb_profile || '', shop_links: row.shop_links || '',
    terms: row.terms || '', defaults: row.defaults || '', brand_context: row.brand_context || 'on',
    // Store policies feed shipping/payment/returns on every WBW export. Opt-ins stay off (admin sets them).
    shipping_policy: row.shipping_policy || '', return_policy: row.return_policy || '', payment_methods: payLabel(row.payment_methods),
  });
  const photo = row.photo_url || (row.photo_key ? `/img/intake/${row.photo_key}` : null);
  if (photo) await sql`update sellers set profile_photo = ${photo} where name = ${saved.name}`;
  return saved.name;
}

// Create (or link) the BootLister seller for an intake row and mark it approved. Safe to run again.
export async function createSellerFromIntake(id, { save, row } = {}) {
  await ensureIntakeTables();
  const r = row || await intakeRow(id);
  const seller = await approveIntakeSeller(r, save || (await import('./wbw')).saveSeller);
  const [out] = await sql`update seller_intake set status = ${'approved'}, seller_name = ${seller}, reviewed_at = now(), updated_at = now() where id = ${r.id} returning *`;
  return publicIntakeView(out);
}

export async function getIntakePhoto(key) {
  await ensureIntakeTables();
  const k = String(key ?? '').trim();
  if (!/^[0-9a-f]{32}$/i.test(k)) return null;
  const [row] = await sql`select photo_bytes, photo_type from seller_intake where photo_key = ${k} limit 1`;
  if (!row?.photo_bytes) return null;
  const bytes = Buffer.isBuffer(row.photo_bytes) ? row.photo_bytes : Buffer.from(row.photo_bytes);
  return { bytes, type: row.photo_type || 'image/jpeg' };
}

async function intakeRow(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError('That intake was not found.', 404);
  const [row] = await sql`select * from seller_intake where id = ${n}`;
  if (!row) throw new HttpError('That intake was not found.', 404);
  return row;
}

async function audit(id, action, actor) {
  await sql`insert into intake_password_audit (intake_id, action, actor) values (${id}, ${action}, ${actor})`;
}

export async function revealIntakePassword(id, actor, env = process.env) {
  await ensureIntakeTables();
  const row = await intakeRow(id);
  if (!row.password_cipher || row.password_cleared_at) throw new Error('No temporary password is stored.');
  const { decryptSecret } = await import('./intake-crypto');
  const password = decryptSecret(row.password_cipher, env);
  await audit(row.id, 'reveal', actor || 'admin');
  return { password, display_name: row.display_name };
}

export async function clearIntakePassword(id, actor) {
  await ensureIntakeTables();
  const row = await intakeRow(id);
  await sql`update seller_intake set password_cipher = null, password_cleared_at = now(), updated_at = now() where id = ${row.id}`;
  await audit(row.id, 'clear', actor || 'admin');
  return publicIntakeView({ ...row, password_cipher: null, password_cleared_at: new Date().toISOString() });
}
