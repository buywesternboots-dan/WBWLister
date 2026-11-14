// Public seller intake submissions. Additive tables only. Temporary passwords stay encrypted.
import { randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { inviteHash, INVITE_MS, newInvite, sellerSlug } from './auth';
import { HttpError } from './http';
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
  photo_ok: v.photo_ok, import_ok: v.import_ok,
});

export async function submitPublicIntake(input, { ip, env = process.env } = {}) {
  await ensureIntakeTables();
  const v = validatePublicIntake(input);
  const cipher = encryptSecret(v.password, env);
  const photo = await storePhoto(v.photo, env);
  let existing;
  if (v.code) {
    const hash = inviteHash(v.code);
    const [row] = await sql`select * from seller_intake where invite_hash = ${hash} limit 1`;
    if (!row) throw new Error('That intake link is not valid.');
    if (row.invite_expires && new Date(row.invite_expires).getTime() < Date.now()) throw new Error('That intake link has expired.');
    existing = row;
  } else {
    const [row] = await sql`select * from seller_intake where lower(email) = ${v.email} and status = 'pending' order by id desc limit 1`;
    existing = row;
  }
  if (!existing) {
    const taken = await sql`select 1 from sellers where lower(email) = ${v.email} limit 1`;
    if (taken.length) throw new Error('That email is already on a seller. Ask for an intake link.');
  }
  if (existing?.status === 'approved') throw new Error('This intake was already approved. Ask if you need to update it.');
  const fields = { ...rowFields(v), password_cipher: cipher, password_cleared_at: null, ...photo, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const [row] = await sql`update seller_intake set
      display_name = ${fields.display_name}, email = ${fields.email}, phone = ${fields.phone}, location = ${fields.location},
      website = ${fields.website}, fb_profile = ${fields.fb_profile}, shop_links = ${fields.shop_links},
      terms = ${fields.terms}, defaults = ${fields.defaults}, brand_context = ${fields.brand_context},
      photo_ok = ${fields.photo_ok}, import_ok = ${fields.import_ok},
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
    photo_ok, import_ok, photo_url, photo_bytes, photo_type, photo_key, password_cipher)
    values ('pending', ${fields.display_name}, ${fields.email}, ${fields.phone}, ${fields.location}, ${fields.website}, ${fields.fb_profile},
      ${fields.shop_links}, ${fields.terms}, ${fields.defaults}, ${fields.brand_context}, ${fields.photo_ok}, ${fields.import_ok},
      ${fields.photo_url}, ${fields.photo_bytes}, ${fields.photo_type}, ${fields.photo_key}, ${fields.password_cipher})
    returning id`;
  return { ok: true, updated: false, id: row.id };
}

export async function listIntakeSubmissions() {
  await ensureIntakeTables();
  const rows = await sql`select id, status, display_name, email, phone, location, website, fb_profile, shop_links, terms, defaults,
    brand_context, photo_ok, import_ok, photo_url, photo_key, password_cipher, password_cleared_at, seller_name, created_at, updated_at
    from seller_intake order by (status = 'pending') desc, created_at desc, id desc`;
  return rows.map(publicIntakeView);
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

export async function approveIntake(id, actor) {
  await ensureIntakeTables();
  const row = await intakeRow(id);
  if (!row.display_name || !row.email) throw new Error('This intake is missing a name or email.');
  const sellers = await sql`select name, email from sellers`;
  const want = (row.seller_name || sellerSlug(row.display_name, row.email, row.phone)).toLowerCase();
  let name = want;
  if (!row.seller_name) {
    for (let i = 2; sellers.some(s => s.name === name); i++) {
      if (i > 1000) throw new Error('Could not choose a seller name.');
      name = `${want.slice(0, 36)}-${i}`;
    }
  }
  const photo = row.photo_url || (row.photo_key ? `/img/intake/${row.photo_key}` : null);
  const { saveSeller } = await import('./wbw');
  const saved = await saveSeller({
    name, display_name: row.display_name, email: row.email, phone: row.phone, location: row.location,
    website: row.website, fb_profile: row.fb_profile, shop_links: row.shop_links,
    terms: row.terms, defaults: row.defaults, brand_context: row.brand_context || 'on',
    photo_ok: row.photo_ok, import_ok: row.import_ok,
  });
  if (photo) await sql`update sellers set profile_photo = ${photo} where name = ${saved.name}`;
  await sql`update seller_intake set status = 'approved', seller_name = ${saved.name}, updated_at = now() where id = ${row.id}`;
  await audit(row.id, 'approve', actor || 'admin');
  return { ...publicIntakeView({ ...row, status: 'approved', seller_name: saved.name }), seller: saved };
}
