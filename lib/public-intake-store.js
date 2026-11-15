// Public seller intake submissions. Additive tables only. Temporary passwords stay encrypted.
// Submit only stores the form. It does not create or update a seller.
import { randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { inviteHash, newInvite } from './auth';
import { HttpError } from './http';
import { DUPLICATE_MESSAGES } from './public-intake-constants';
import { newTermsToken } from './terms-acceptance';
import { encryptSecret } from './intake-crypto';
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
    await q`alter table seller_intake add column if not exists terms_token text, add column if not exists terms_sent_at timestamptz,
      add column if not exists terms_accepted_at timestamptz, add column if not exists terms_accepted_name text,
      add column if not exists terms_accepted_ip text, add column if not exists terms_accepted_ua text`;
    await q`alter table seller_intake add column if not exists sells_belts boolean, add column if not exists belt_types text,
      add column if not exists measurement_method text`;
    await q`create unique index if not exists seller_intake_terms_token_idx on seller_intake (terms_token)`;
    await q`create index if not exists seller_intake_email_idx on seller_intake (lower(email))`;
    await q`create index if not exists seller_intake_status_idx on seller_intake (status, created_at desc)`;
  })().catch(e => { ready = null; throw e; });
}

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
  terms_token: v.terms_token, sells_belts: v.sells_belts, belt_types: v.belt_types, measurement_method: v.measurement_method,
  pricing_change: v.pricing_change, pricing_notes: v.pricing_notes, shipping_policy: v.shipping_policy,
  payment_methods: v.payment_methods ? JSON.stringify(v.payment_methods) : null, return_policy: v.return_policy,
  username: v.username, aliases: v.aliases, bio: v.bio, fun_fact: v.fun_fact, sells_where: v.sells_where,
  boot_types: v.boot_types, pairs_estimate: v.pairs_estimate, notes: v.notes, email_prefs: JSON.stringify(v.email_prefs),
});

// 'seller' if the email or username is an existing BootLister seller, 'intake' if an earlier submission used it, else 'none'.
export async function checkIntakeAccount({ email, username }) {
  await ensureIntakeTables();
  const e = email ? String(email).toLowerCase() : null;
  const u = username ? String(username).toLowerCase() : null;
  const [s] = await sql`select 1 from sellers where (${e}::text is not null and lower(email) = ${e}) or (${u}::text is not null and lower(name) = ${u}) limit 1`;
  if (s) return 'seller';
  const [i] = await sql`select 1 from seller_intake where (${e}::text is not null and lower(email) = ${e}) or (${u}::text is not null and lower(username) = ${u}) limit 1`;
  return i ? 'intake' : 'none';
}

export async function submitPublicIntake(input, { ip, env = process.env } = {}) {
  await ensureIntakeTables();
  const v = { ...validatePublicIntake(input), terms_token: newTermsToken() };
  const dup = await checkIntakeAccount(v);
  if (dup !== 'none') throw new HttpError(DUPLICATE_MESSAGES[dup], 409);
  const cipher = v.password ? encryptSecret(v.password, env) : null;
  const photo = await storePhoto(v.photo, env);
  let existing;
  if (v.code) {
    const hash = inviteHash(v.code);
    const [row] = await sql`select * from seller_intake where invite_hash = ${hash} limit 1`;
    if (!row) throw new Error('That intake link is not valid.');
    if (row.invite_expires && new Date(row.invite_expires).getTime() < Date.now()) throw new Error('That intake link has expired.');
    existing = row;
  }
  // Already-approved invite or row: store a new submission instead of changing the old one.
  if (existing?.status === 'approved') existing = null;
  const fields = { ...rowFields(v), password_cipher: cipher, password_cleared_at: null, ...photo, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const [row] = await sql`update seller_intake set
      display_name = ${fields.display_name}, email = ${fields.email}, phone = ${fields.phone}, location = ${fields.location},
      website = ${fields.website}, fb_profile = ${fields.fb_profile}, shop_links = ${fields.shop_links},
      terms = ${fields.terms}, defaults = ${fields.defaults}, brand_context = ${fields.brand_context},
      photo_ok = ${fields.photo_ok}, import_ok = ${fields.import_ok}, import_mode = ${fields.import_mode}, has_wbw_account = ${fields.has_wbw_account},
      terms_token = coalesce(terms_token, ${fields.terms_token}),
      sells_belts = ${fields.sells_belts}, belt_types = ${fields.belt_types}, measurement_method = ${fields.measurement_method},
      pricing_change = ${fields.pricing_change}, pricing_notes = ${fields.pricing_notes}, shipping_policy = ${fields.shipping_policy},
      payment_methods = ${fields.payment_methods}::jsonb, return_policy = ${fields.return_policy},
      username = ${fields.username}, aliases = ${fields.aliases}, bio = ${fields.bio}, fun_fact = ${fields.fun_fact},
      sells_where = ${fields.sells_where}, boot_types = ${fields.boot_types}, pairs_estimate = ${fields.pairs_estimate},
      notes = ${fields.notes}, email_prefs = ${fields.email_prefs}::jsonb,
      password_cipher = ${fields.password_cipher}, password_cleared_at = null,
      photo_url = coalesce(${fields.photo_url}, photo_url),
      photo_bytes = coalesce(${fields.photo_bytes}, photo_bytes),
      photo_type = coalesce(${fields.photo_type}, photo_type),
      photo_key = coalesce(${fields.photo_key}, photo_key),
      updated_at = now()
      where id = ${existing.id} returning *`;
    return { ok: true, updated: true, id: row.id };
  }
  const [row] = await sql`insert into seller_intake (
    status, display_name, email, phone, location, website, fb_profile, shop_links, terms, defaults, brand_context,
    photo_ok, import_ok, photo_url, photo_bytes, photo_type, photo_key, password_cipher,
    username, aliases, bio, fun_fact, sells_where, boot_types, pairs_estimate, notes, email_prefs, import_mode, has_wbw_account,
    pricing_change, pricing_notes, shipping_policy, payment_methods, return_policy, terms_token,
    sells_belts, belt_types, measurement_method)
    values ('pending', ${fields.display_name}, ${fields.email}, ${fields.phone}, ${fields.location}, ${fields.website}, ${fields.fb_profile},
      ${fields.shop_links}, ${fields.terms}, ${fields.defaults}, ${fields.brand_context}, ${fields.photo_ok}, ${fields.import_ok},
      ${fields.photo_url}, ${fields.photo_bytes}, ${fields.photo_type}, ${fields.photo_key}, ${fields.password_cipher},
      ${fields.username}, ${fields.aliases}, ${fields.bio}, ${fields.fun_fact}, ${fields.sells_where}, ${fields.boot_types},
      ${fields.pairs_estimate}, ${fields.notes}, ${fields.email_prefs}::jsonb, ${fields.import_mode}, ${fields.has_wbw_account},
      ${fields.pricing_change}, ${fields.pricing_notes}, ${fields.shipping_policy}, ${fields.payment_methods}::jsonb, ${fields.return_policy}, ${fields.terms_token},
      ${fields.sells_belts}, ${fields.belt_types}, ${fields.measurement_method})
    returning id`;
  return { ok: true, updated: false, id: row.id };
}

export async function listIntakeSubmissions() {
  await ensureIntakeTables();
  // Older submissions get an acceptance token the first time the admin list loads.
  for (const r of await sql`select id from seller_intake where terms_token is null and email is not null`) {
    await sql`update seller_intake set terms_token = ${newTermsToken()} where id = ${r.id} and terms_token is null`;
  }
  const rows = await sql`select id, status, display_name, email, phone, location, website, fb_profile, shop_links, terms, defaults,
    brand_context, photo_ok, import_ok, photo_url, photo_key, password_cipher, password_cleared_at, seller_name, created_at, updated_at,
    username, aliases, bio, fun_fact, sells_where, boot_types, pairs_estimate, notes, email_prefs, import_mode, has_wbw_account,
    pricing_change, pricing_notes, shipping_policy, payment_methods, return_policy, reviewed_at,
    terms_token, terms_sent_at, terms_accepted_at, terms_accepted_name, sells_belts, belt_types, measurement_method
    from seller_intake order by (status = 'pending') desc, created_at desc, id desc`;
  return rows.map(publicIntakeView);
}

// New applications Dan has not reviewed yet. Unfilled invite links (no email) do not count.
export async function countPendingApplications() {
  await ensureIntakeTables();
  const [r] = await sql`select count(*)::int as n from seller_intake where status = 'pending' and email is not null`;
  return r?.n ?? 0;
}

// Approve or decline an application. Only the intake row changes; no seller is created here.
export async function reviewIntake(id, decision) {
  await ensureIntakeTables();
  const row = await intakeRow(id);
  const [out] = await sql`update seller_intake set status = ${decision}, reviewed_at = now(), updated_at = now() where id = ${row.id} returning *`;
  return publicIntakeView(out);
}

// Terms portal. Look up by the unguessable token only; return only the acceptance date.
export async function getTermsByToken(token) {
  await ensureIntakeTables();
  const [r] = await sql`select terms_accepted_at from seller_intake where terms_token = ${String(token)} limit 1`;
  return r ? { accepted_at: r.terms_accepted_at } : null;
}

// Records the first acceptance only. Returns null for an unknown token.
export async function acceptTerms(token, { full_name }, { ip, ua } = {}) {
  await ensureIntakeTables();
  const [r] = await sql`update seller_intake set terms_accepted_at = now(), terms_accepted_name = ${full_name},
    terms_accepted_ip = ${ip || null}, terms_accepted_ua = ${ua || null}, updated_at = now()
    where terms_token = ${String(token)} and terms_accepted_at is null returning terms_accepted_at`;
  if (r) return { accepted_at: r.terms_accepted_at };
  return getTermsByToken(token);
}

export async function setTermsSent(id, sent) {
  await ensureIntakeTables();
  const row = await intakeRow(id);
  const [out] = await sql`update seller_intake set terms_sent_at = ${sent ? new Date().toISOString() : null}, updated_at = now() where id = ${row.id} returning *`;
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

export async function createIntakeInvite() {
  await ensureIntakeTables();
  const inv = newInvite();
  await sql`insert into seller_intake (status, display_name, invite_hash, invite_expires)
    values ('pending', '', ${inv.hash}, ${inv.expires})`;
  return { code: inv.code, expires: inv.expires };
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
