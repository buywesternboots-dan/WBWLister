// Mock WBW backend. Replace this file only when connecting to the real WBW.
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';

let db;
const sql = (...a) => (db ??= neon(process.env.DATABASE_URL))(...a);
const BOOT = /\b(boots?|cowboy|western|roper|ariat|lucchese|tony lama|justin|dan post|boulet|old gringo|corral|durango|nocona|laredo|abilene|anderson bean|rios of mercedes|black jack|twisted x|frye|laramie|t\.?o\.? stanley|stetson|larry mahan|tecovas|rocketbuster|carlos lujan|olathe|hyer|ferrini|los altos|cuadra|caborca|chisos|lizard|ostrich|caiman|gator|alligator|python|eel|stingray|full quill|wingtip)\b/i;
const STATUS = { publish: 'published', remove: 'removed', restore: 'review' };

let ready;
const init = () => ready ??= sql`create table if not exists items (
  id serial primary key, seller text not null, status text not null default 'review', boot text not null,
  source text, source_id text, title text, price numeric, description text, size text, condition text, brand text,
  photos text[] not null default '{}', created_at timestamptz default now(), unique (seller, source, source_id))`;

export async function uploadPhoto(src) {
  const body = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  return (await put(`photos/${crypto.randomUUID()}.jpg`, body, { access: 'public', contentType: body.type || 'image/jpeg' })).url;
}

export async function getItems(seller, status) {
  await init();
  return sql`select * from items where seller = ${seller} and status = ${status} order by created_at desc`;
}

export async function getSourceIds(seller, source) {
  await init();
  return (await sql`select source_id from items where seller = ${seller} and source = ${source}`).map(r => r.source_id);
}

// New item → insert. Existing → skip, unless overwrite is set and the listing changed (then update and send back to review).
export async function createItem(seller, it) {
  await init();
  const v = k => it[k] ?? null;
  const [old] = it.source_id ? await sql`select * from items where seller = ${seller} and source = ${v('source')} and source_id = ${it.source_id}` : [];
  const same = old && ['title', 'description', 'size', 'condition'].every(k => (old[k] ?? '') === (it[k] ?? '')) && Number(old.price) === Number(it.price);
  if (old && (!it.overwrite || same || old.status === 'removed')) return null;
  const photos = await Promise.all((it.photos || []).map(uploadPhoto));
  const boot = BOOT.test(`${it.title} ${it.description} ${it.brand}`) ? 'boot' : 'unsure';
  if (old) return { ...(await sql`update items set status = 'review', boot = ${boot}, title = ${v('title')}, price = ${v('price')}, description = ${v('description')},
    size = ${v('size')}, condition = ${v('condition')}, photos = ${photos} where id = ${old.id} returning *`)[0], updated: true };
  const [row] = await sql`insert into items (seller, boot, source, source_id, title, price, description, size, condition, brand, photos)
    values (${seller}, ${boot}, ${v('source')}, ${v('source_id')}, ${v('title')}, ${v('price')}, ${v('description')}, ${v('size')}, ${v('condition')}, ${v('brand')}, ${photos})
    returning *`;
  return row;
}

// Moves items from this source that are no longer in the seller's current listings to Removed.
export async function syncSource(seller, source, sourceIds) {
  return (await sql`update items set status = 'removed' where seller = ${seller} and source = ${source} and status <> 'removed'
    and not (source_id = any(${sourceIds})) returning id`).length;
}

export async function updateItems(seller, ids, p) {
  const v = k => p[k] === '' ? null : p[k] ?? null;
  await sql`update items set title = coalesce(${v('title')}, title), price = coalesce(${v('price')}::numeric, price),
    description = coalesce(${v('description')}, description), size = coalesce(${v('size')}, size),
    condition = coalesce(${v('condition')}, condition), brand = coalesce(${v('brand')}, brand)
    where seller = ${seller} and id = any(${ids})`;
}

export async function lowerPrice(seller, ids, percent = 0, amount = 0) {
  await sql`update items set price = greatest(round(price * (1 - ${percent}::numeric / 100) - ${amount}::numeric, 2), 0)
    where seller = ${seller} and id = any(${ids})`;
}

export async function setStatus(seller, ids, action) {
  if (!STATUS[action]) throw new Error(`Unknown action: ${action}`);
  await sql`update items set status = ${STATUS[action]} where seller = ${seller} and id = any(${ids})`;
}
