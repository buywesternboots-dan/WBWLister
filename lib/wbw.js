// Mock WBW backend. Replace this file only when connecting to the real WBW.
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';

let db;
const conn = () => db ??= neon(process.env.DATABASE_URL);
const sql = (...a) => conn()(...a);
const BOOT = /\b(boots?|cowboy|western|roper|ariat|lucchese|tony lama|justin|dan post|boulet|old gringo|corral|durango|nocona|laredo|abilene|anderson bean|rios of mercedes|black jack|twisted x|frye|laramie|t\.?o\.? stanley|stetson|larry mahan|tecovas|rocketbuster|carlos lujan|olathe|hyer|ferrini|los altos|cuadra|caborca|chisos|lizard|ostrich|caiman|gator|alligator|python|eel|stingray|full quill|wingtip|croc(odile)?|hippo|elephant|sea turtle|turtle|shark|bison|el dorado)\b/i;
const BELT = /\b(belts?|buckles?)\b/i;
// Category (stored in the boot column): belt if the title says so, boot if anything looks western, else unsure.
const category = it => BELT.test(it.title) ? 'belt' : BOOT.test(`${it.title} ${it.description} ${it.brand}`) ? 'boot' : 'unsure';
const STATUS = { publish: 'published', remove: 'removed', restore: 'review' };
const REMOVED_AT = status => status === 'removed' ? new Date() : null;

// Listing fields (all editable). Text unless listed in NUMERIC.
export const FIELDS = ['title', 'price', 'wbw_price', 'brand', 'sized_for', 'size', 'width', 'material_type', 'material', 'made_in',
  'condition', 'color', 'sole', 'heel', 'toe', 'description'];
const NUMERIC = ['price', 'wbw_price'];
const NEW_COLS = FIELDS.filter(f => !['title', 'price', 'brand', 'size', 'condition', 'description'].includes(f));

// Seller-standardized "Label: value" lines in the description → field. These win over everything except title/price.
const DESC_LABELS = { width: 'width', 'wbw price': 'wbw_price', 'western boot world price': 'wbw_price', size: 'size', brand: 'brand', maker: 'brand',
  'sized for': 'sized_for', gender: 'sized_for', 'material type': 'material_type', material: 'material', leather: 'material',
  'where made': 'made_in', 'made in': 'made_in', origin: 'made_in', condition: 'condition', color: 'color', colour: 'color',
  sole: 'sole', heel: 'heel', toe: 'toe', 'toe shape': 'toe' };
const labeled = desc => Object.fromEntries((desc ?? '').split('\n').map(l => l.match(/^\s*([a-z][a-z ’'/-]{1,30}?)\s*:\s*(.+?)\s*$/i))
  .filter(m => m && DESC_LABELS[m[1].toLowerCase().replace(/[’']/g, '')]).map(m => [DESC_LABELS[m[1].toLowerCase().replace(/[’']/g, '')], m[2]]));

// Fills WBW fields from the listing text where the source didn't provide them.
const EXOTIC = /\b(full quill ostrich|smooth ostrich|ostrich leg|ostrich|caiman belly|caiman|crocodile|croc|alligator|gator|lizard|python|snake|eel|stingray|shark|hippo|elephant|sea turtle|bison|buffalo|kangaroo)\b/i;
const LEATHER = /\b(calfskin|calf|cowhide|goat|suede|roughout|leather)\b/i;
const cap = s => s && s[0].toUpperCase() + s.slice(1).toLowerCase();
function enrich(raw) {
  const lab = labeled(raw.description);
  if (lab.wbw_price) lab.wbw_price = lab.wbw_price.replace(/[^\d.]/g, '') || undefined;
  if (lab.sized_for) lab.sized_for = /wom|lad|fem/i.test(lab.sized_for) ? 'Women' : /men|male/i.test(lab.sized_for) ? 'Men' : lab.sized_for;
  const it = { ...raw, ...Object.fromEntries(Object.entries(lab).filter(([, v]) => v)) };
  const text = `${it.title}\n${it.description ?? ''}`, find = re => text.match(re)?.[1];
  const sz = `${lab.size ?? ''} ${it.title} ${it.size ?? ''}`.match(/\b(\d{1,2}(?:\.5)?) ?([2-4]E|EEEE|EEE|EE|[A-EW])\b/) || `${it.size ?? ''}`.match(/(\d{1,2}(?:\.5)?)/)
    || text.match(/\bsize:?[ \t]*(\d{1,2}(?:\.5)?)\b/i);
  const exotic = find(EXOTIC), leather = find(LEATHER);
  return {
    ...it,
    size: sz?.[1] ?? it.size ?? null,
    width: lab.width || sz?.[2] || it.width || null,
    sized_for: it.sized_for || (/\b(women['’]?s|ladies)\b/i.test(text) ? 'Women' : /\b(men['’]?s)\b/i.test(text) ? 'Men' : null),
    material: it.material || cap(exotic || leather) || null,
    material_type: it.material_type || (exotic ? 'Exotic' : leather ? 'Leather' : null),
    made_in: it.made_in || find(/where made:?[ \t]*([^\n]+)/i) || find(/made in (?:the )?([a-z .]+?)(?:[.,!\n]|$)/i) || null,
    color: it.color || cap(find(/\b(black|brown|tan|cognac|chocolate|honey|red|bone|white|grey|gray|blue|green|burgundy|oxblood|natural|camel|saddle|rust)\b/i)) || null,
    toe: it.toe || find(/\b(\d|snip|square|round|j|r|cutter|roper|needle|pointed|wide square|broad square|medium round|french) toe\b/i)?.replace(/^\w/, c => c.toUpperCase()).concat(' toe') || null,
    heel: it.heel || cap(find(/\b(riding|walking|roper|cuban|stockman|underslung|block|fashion|dogger) heel/i))?.concat(' heel') || null,
    sole: it.sole || cap(find(/\b(leather|rubber|crepe|lug|vibram|composite) soles?\b/i)) || (/\bpeg(s|ged)\b/i.test(text) ? 'Leather, pegged' : null),
  };
}

let ready;
const init = () => ready ??= sql`create table if not exists items (
  id serial primary key, seller text not null, status text not null default 'review', boot text not null,
  source text, source_id text, title text, price numeric, description text, size text, condition text, brand text,
  photos text[] not null default '{}', created_at timestamptz default now(), unique (seller, source, source_id))`
  .then(() => conn().query(`alter table items add column if not exists removed_at timestamptz, add column if not exists enriched boolean default false,
    ${NEW_COLS.map(c => `add column if not exists ${c} ${NUMERIC.includes(c) ? 'numeric' : 'text'}`).join(', ')}`))
  .then(() => sql`update items set removed_at = now() where status = 'removed' and removed_at is null`)
  .then(() => sql`update items set seller = lower(trim(seller)) where seller <> lower(trim(seller))`)
  .then(() => sql`update items set boot = 'belt' where boot <> 'belt' and title ~* '\\m(belts?|buckles?)\\M'`)
  .then(() => sql`alter table items add column if not exists enrich_v int default 0`)
  .then(async () => { for (const r of await sql`select * from items where coalesce(enrich_v, 0) < ${ENRICH_V}`) {
    const e = enrich(r);
    await setFields(r.id, { ...e, wbw_price: e.wbw_price ?? r.price, enrich_v: ENRICH_V });
  } });
const ENRICH_V = 2; // bump to re-run enrich() over existing items after parsing changes

// Writes the given columns of `it` (FIELDS plus internal ones) to one item.
const WRITABLE = [...FIELDS, 'boot', 'status', 'photos', 'enriched', 'enrich_v'];
const setFields = (id, it) => {
  const keys = WRITABLE.filter(f => it[f] !== undefined);
  return keys.length ? conn().query(`update items set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`,
    [id, ...keys.map(k => it[k] === '' ? null : it[k])]) : [];
};

export async function uploadPhoto(src) {
  const body = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  return (await put(`photos/${crypto.randomUUID()}.jpg`, body, { access: 'public', contentType: body.type || 'image/jpeg' })).url;
}

// Removed items move to Archived after 30 days.
export async function getItems(seller, status) {
  await init();
  await sql`update items set status = 'archived' where seller = ${seller} and status = 'removed' and removed_at < now() - interval '30 days'`;
  return sql`select * from items where seller = ${seller} and status = ${status} order by created_at desc`;
}

export async function getSourceIds(seller, source) {
  await init();
  return (await sql`select source_id from items where seller = ${seller} and source = ${source}`).map(r => r.source_id);
}

// New item → insert. Existing → skip, unless overwrite is set and the listing changed (then update and send back to review).
export async function createItem(seller, raw) {
  await init();
  const it = enrich(raw);
  const [old] = it.source_id ? await sql`select * from items where seller = ${seller} and source = ${it.source ?? null} and source_id = ${it.source_id}` : [];
  const same = old && ['title', 'description', 'condition'].every(k => (old[k] ?? '') === (it[k] ?? '')) && Number(old.price) === Number(it.price);
  if (old && (!it.overwrite || same || ['removed', 'archived'].includes(old.status))) return null;
  const photos = await Promise.all((it.photos || []).map(uploadPhoto));
  const fields = { ...Object.fromEntries(FIELDS.map(f => [f, it[f] ?? null])), wbw_price: it.wbw_price ?? old?.wbw_price ?? it.price ?? null, enrich_v: ENRICH_V };
  const id = old?.id ?? (await sql`insert into items (seller, boot, source, source_id, photos, enriched)
    values (${seller}, ${category(it)}, ${it.source ?? null}, ${it.source_id ?? null}, ${photos}, true) returning id`)[0].id;
  const [row] = await setFields(id, old ? { ...fields, status: 'review', boot: category(it), photos } : fields);
  return old ? { ...row, updated: true } : row;
}

// Moves items from this source that are no longer in the seller's current listings to Removed.
export async function syncSource(seller, source, sourceIds) {
  return (await sql`update items set status = 'removed', removed_at = now() where seller = ${seller} and source = ${source} and status not in ('removed', 'archived')
    and not (source_id = any(${sourceIds})) returning id`).length;
}

export async function updateItems(seller, ids, p) {
  for (const [r] of await Promise.all(ids.map(id => sql`select id from items where seller = ${seller} and id = ${id}`))) if (r) await setFields(r.id, p);
}

// Bulk price changes apply to the WBW price.
export async function lowerPrice(seller, ids, percent = 0, amount = 0) {
  await sql`update items set wbw_price = greatest(round(coalesce(wbw_price, price) * (1 - ${percent}::numeric / 100) - ${amount}::numeric, 2), 0)
    where seller = ${seller} and id = any(${ids})`;
}

export async function setStatus(seller, ids, action) {
  if (!STATUS[action]) throw new Error(`Unknown action: ${action}`);
  await sql`update items set status = ${STATUS[action]}, removed_at = ${REMOVED_AT(STATUS[action])} where seller = ${seller} and id = any(${ids})`;
}
