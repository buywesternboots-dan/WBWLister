// Mock WBW backend. Replace this file only when connecting to the real WBW.
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { createHash } from 'crypto';
import { findBrand, findMaterial } from './vocab';

let db;
const conn = () => db ??= neon(process.env.DATABASE_URL);
const sql = (...a) => conn()(...a);
const STATUS = { publish: 'published', remove: 'removed', restore: 'review' };
const REMOVED_AT = status => status === 'removed' ? new Date() : null;
const MAX_PHOTOS = 30;

// Listing fields (all editable). Text unless listed in NUMERIC.
export const FIELDS = ['title', 'price', 'wbw_price', 'brand', 'sized_for', 'size', 'width', 'material_type', 'material', 'made_in',
  'condition', 'color', 'sole', 'heel', 'toe', 'description'];
const NUMERIC = ['price', 'wbw_price'];
const NEW_COLS = FIELDS.filter(f => !['title', 'price', 'brand', 'size', 'condition', 'description'].includes(f));

// Category (stored in the boot column) + boot_score (0–1, how likely it is a boot). Boots/Belts only when near certain
// (≥ 0.97); anything with no boot/western signal is Other; everything in between is Unsure, sorted by score.
const WESTERN = /\b(cow[\s-]?(boy|girl|by|boi|bow)z?s?|w[ae]st[ae]rn|westren|vaquer[oa]s?|buckaroo|ropers?)\b/i;
const BOOT_WORD = /\b(boots?|bootz|botts?|botas?|booties)\b/i;
const BOOT_PHRASE = /\b(exotic|custom|hand[- ]?made|texas|pre[- ]?ban|vintage)\s+(cowboy\s+|western\s+)?boots?\b/i;
const SIZE_WIDTH = /\b\d{1,2}(\.5)?\s?-?\s?([2-4]E|EEEE|EEE|EE|[A-EMW])\b/;
const BELT = /\b(belts?|buckles?)\b/i;
// Title words that mean the item is about boots but isn't a pair of boots (bedding, art, clothing, accessories…).
const NOT_BOOT = /\b(sheets?|bedding|comforter|blankets?|quilts?|pillows?|pillowcases?|curtains?|towels?|rugs?|posters?|photos?|photograph|autograph(ed)?|paintings?|canvas|figurines?|statues?|ornaments?|toys?|dolls?|lamps?|mugs?|planters?|vases?|decor|signs?|stickers?|decals?|books?|dvds?|vhs|t-?shirts?|tees?|hoodies?|jackets?|vests?|hats?|jeans|skirts?|jewelry|necklaces?|earrings?|bracelets?|keychains?|wallets?|purses?|handbags?|costumes?|cake toppers?|cookie cutters?|fabric|magnets?|patches|spurs|saddles?|chaps|boot ?(jacks?|polish|cream|conditioner|oil|dryers?|trays?|racks?|scrapers?|stretchers?|trees|bags?|covers?|cuffs|charms?|chains?|straps?|harness(es)?|socks|box(es)?))\b/i;
export function classify(it) {
  const title = it.title ?? '', text = `${title}\n${it.description ?? ''}`;
  if (BELT.test(title) && !BOOT_WORD.test(title)) return { boot: 'belt', boot_score: 0 };
  const word = BOOT_WORD.test(text), sized = SIZE_WIDTH.test(title), brand = !!findBrand(text), exotic = !!findMaterial(text)?.exotic;
  const bootish = word || sized || brand || exotic, western = WESTERN.test(text);
  const score = NOT_BOOT.test(title) ? (bootish || western ? 0.2 : 0)
    : western && bootish ? 0.99
    : BOOT_PHRASE.test(text) ? 0.95
    : word && (brand || exotic || sized) ? 0.93
    : brand && (exotic || sized) ? 0.9
    : word ? 0.7
    : bootish || western ? 0.4 : 0;
  return { boot: score >= 0.97 ? 'boot' : score === 0 ? 'other' : 'unsure', boot_score: score };
}

// Seller-standardized "Label: value" lines in the description → field. These win over everything except title/price.
const DESC_LABELS = { width: 'width', 'wbw price': 'wbw_price', 'western boot world price': 'wbw_price', size: 'size', brand: 'brand', maker: 'brand',
  'sized for': 'sized_for', gender: 'sized_for', 'material type': 'material_type', material: 'material', leather: 'material',
  'where made': 'made_in', 'made in': 'made_in', origin: 'made_in', condition: 'condition', color: 'color', colour: 'color',
  sole: 'sole', heel: 'heel', toe: 'toe', 'toe shape': 'toe' };
const labeled = desc => Object.fromEntries((desc ?? '').split('\n').map(l => l.match(/^\s*([a-z][a-z ’'/-]{1,30}?)\s*:\s*(.+?)\s*$/i))
  .filter(m => m && DESC_LABELS[m[1].toLowerCase().replace(/[’']/g, '')]).map(m => [DESC_LABELS[m[1].toLowerCase().replace(/[’']/g, '')], m[2]]));
const GENDER = /\b(women['’]?s|womens|ladies|cowgirls?|kids|youth|toddlers?|children['’]?s|boys['’]?|girls['’]?|men['’]?s|mens)\b/i;
const gender = w => /^(wom|lad|cowg)/i.test(w) ? 'Women' : /^(kid|you|tod|chi|boy|gir)/i.test(w) ? 'Kids' : 'Men';
const cap = s => s && s[0].toUpperCase() + s.slice(1).toLowerCase();

// Fills WBW fields from the listing. `guessed` = read from free text (seller should verify);
// `defaulted` = not in the listing at all, a default was used (seller is alerted; width counts as missing).
function enrich(raw) {
  const lab = labeled(raw.description);
  if (lab.wbw_price) lab.wbw_price = lab.wbw_price.replace(/[^\d.]/g, '') || undefined;
  if (lab.sized_for) lab.sized_for = gender(lab.sized_for);
  const it = { ...raw, ...Object.fromEntries(Object.entries(lab).filter(([, v]) => v)) };
  const text = `${it.title}\n${it.description ?? ''}`, find = re => text.match(re)?.[1];
  const sz = `${lab.size ?? ''} ${it.title} ${it.size ?? ''}`.match(/\b(\d{1,2}(?:\.5)?)[ -]?([2-4]E|EEEE|EEE|EE|[A-EMW])\b/) || `${it.size ?? ''}`.match(/(\d{1,2}(?:\.5)?)/)
    || text.match(/\bsize:?[ \t]*(\d{1,2}(?:\.5)?)\b/i);
  const mat = findMaterial(text), brand = it.brand || findBrand(it.title)?.name || findBrand(text)?.name || null;
  const noBrand = brand ? text.replace(findBrand(brand)?.re ?? brand, '') : text; // so "Black Jack" isn't read as a color
  const who = (it.title.match(GENDER) || text.match(GENDER))?.[1];
  const width = lab.width || sz?.[2] || it.width || null;
  const out = {
    ...it,
    brand,
    size: sz?.[1] ?? it.size ?? null,
    width: width || 'M', // default M; flagged as missing below
    sized_for: it.sized_for || (who ? gender(who) : 'Men'), // men's unless the listing says otherwise
    // Only two conditions: New when explicitly new (not "like new"), otherwise Broken In.
    condition: /^\s*(brand )?new\s*$/i.test(it.condition ?? '')
      || /\b(brand new|new with(out)? (tags|box)|new in box|nwt|nwob|nib|never worn|unworn|deadstock)\b/i.test(text) ? 'New' : 'Broken In',
    material: it.material || mat?.name || null,
    material_type: it.material_type || (mat ? (mat.exotic ? 'Exotic' : 'Leather') : null),
    made_in: it.made_in || find(/where made:?[ \t]*([^\n]+)/i) || find(/made in (?:the )?([a-z .]+?)(?:[.,!\n]|$)/i) || null,
    color: it.color || cap(noBrand.match(/\b(black|brown|tan|cognac|chocolate|honey|red|bone|white|grey|gray|blue|green|burgundy|oxblood|natural|camel|saddle|rust)\b/i)?.[1]) || null,
    toe: it.toe || find(/\b(\d|snip|square|round|j|r|cutter|roper|needle|pointed|wide square|broad square|medium round|french) toe\b/i)?.replace(/^\w/, c => c.toUpperCase()).concat(' toe') || null,
    heel: it.heel || cap(find(/\b(riding|walking|roper|cuban|stockman|underslung|block|fashion|dogger) heel/i))?.concat(' heel') || null,
    sole: it.sole || cap(find(/\b(leather|rubber|crepe|lug|vibram|composite) soles?\b/i)) || (/\bpeg(s|ged)\b/i.test(text) ? 'Leather, pegged' : null),
  };
  const defaulted = width ? [] : ['width'];
  // Size/width always count as read-from-text unless the seller labeled them (the extension reads them from the title).
  const given = f => lab[f] || (raw[f] && !['size', 'width'].includes(f)) || defaulted.includes(f) || (f === 'sized_for' && !who); // default Men isn't flagged
  return { ...out, ...classify(out), defaulted, guessed: [...GUESSED, 'size'].filter(f => out[f] && !given(f)) };
}

let ready;
const init = () => ready ??= sql`create table if not exists items (
  id serial primary key, seller text not null, status text not null default 'review', boot text not null,
  source text, source_id text, title text, price numeric, description text, size text, condition text, brand text,
  photos text[] not null default '{}', created_at timestamptz default now(), unique (seller, source, source_id))`
  .then(() => conn().query(`alter table items add column if not exists removed_at timestamptz, add column if not exists enriched boolean default false,
    add column if not exists enrich_v int default 0, add column if not exists guessed text[] default '{}', add column if not exists src_hash text,
    add column if not exists defaulted text[] default '{}', add column if not exists boot_score real,
    ${NEW_COLS.map(c => `add column if not exists ${c} ${NUMERIC.includes(c) ? 'numeric' : 'text'}`).join(', ')}`))
  .then(() => sql`update items set removed_at = now() where status = 'removed' and removed_at is null`)
  .then(() => sql`update items set seller = lower(trim(seller)) where seller <> lower(trim(seller))`)
  .then(async () => { // re-run enrich() on items imported under older rules (guessed fields re-derived; seller-set WBW price kept)
    const rows = await sql`select * from items where coalesce(enrich_v, 0) < ${ENRICH_V}`;
    for (let i = 0; i < rows.length; i += 25) await Promise.all(rows.slice(i, i + 25).map(r => {
      const e = enrich({ ...r, ...Object.fromEntries([...GUESSED, 'size'].map(f => [f, null])), size: r.size });
      return setFields(r.id, { ...e, wbw_price: e.wbw_price ?? r.wbw_price ?? r.price, enrich_v: ENRICH_V });
    }));
  })
  .catch(e => { ready = null; throw e; }); // retry setup on the next request instead of caching the failure
const ENRICH_V = 6; // bump to re-run enrich() over existing items after parsing changes
// Fields enrich() may infer from free text (flagged for the seller to verify).
const GUESSED = ['brand', 'sized_for', 'width', 'material_type', 'material', 'made_in', 'color', 'sole', 'heel', 'toe'];

// Writes the given columns of `it` (FIELDS plus internal ones) to one item.
const WRITABLE = [...FIELDS, 'boot', 'boot_score', 'status', 'photos', 'enriched', 'enrich_v', 'guessed', 'defaulted', 'src_hash'];
const setFields = (id, it) => {
  const keys = WRITABLE.filter(f => it[f] !== undefined);
  return keys.length ? conn().query(`update items set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning *`,
    [id, ...keys.map(k => it[k] === '' ? null : it[k])]) : [];
};

// Every photo must come through (up to 30), or the import fails. Facebook photo links expire, so those are copied to
// Blob storage; other stores' links are permanent, so they're only checked (saves Blob quota).
const EXPIRING = /fbcdn\.net|scontent/;
async function importPhoto(src, n) {
  const r = await fetch(src, { method: EXPIRING.test(src) ? 'GET' : 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok && r.status !== 405) throw new Error(`Photo ${n} didn't import (HTTP ${r.status})`);
  if (!EXPIRING.test(src)) return src;
  return (await put(`photos/${crypto.randomUUID()}.jpg`, await r.blob(), { access: 'public', contentType: r.headers.get('content-type') || 'image/jpeg' })).url;
}

// Removed items move to Archived after 30 days.
export async function getItems(seller, status) {
  await init();
  await sql`update items set status = 'archived' where seller = ${seller} and status = 'removed' and removed_at < now() - interval '30 days'`;
  return sql`select * from items where seller = ${seller} and status = ${status} order by created_at desc`;
}

// All sellers with their item counts (mock WBW: no accounts yet, so anyone can switch sellers).
export async function getSellers() {
  await init();
  return sql`select seller, count(*) filter (where status = 'review')::int as review, count(*) filter (where status not in ('removed', 'archived'))::int as active
    from items group by seller order by seller`;
}

export async function getSourceIds(seller, source) {
  await init();
  return (await sql`select source_id from items where seller = ${seller} and source = ${source}`).map(r => r.source_id);
}

// Fingerprint of what the source said (not the seller's edits), to tell real source changes from re-imports.
const SOURCE_KEYS = ['title', 'price', 'description', 'condition', 'brand', 'size', 'sized_for', 'color', 'material'];
const fingerprint = raw => createHash('sha1').update(JSON.stringify([...SOURCE_KEYS.map(k => String(raw[k] ?? '').trim()), (raw.photos ?? []).length])).digest('hex'); // photo count, not URLs (FB's change daily)

// New item → insert. Already imported → ignored, unless the source listing changed since (then refreshed and sent back to review).
export async function createItem(seller, raw) {
  await init();
  const it = enrich(raw), src_hash = fingerprint(raw);
  const [old] = it.source_id ? await sql`select * from items where seller = ${seller} and source = ${it.source ?? null} and source_id = ${it.source_id}` : [];
  if (old && !old.src_hash) await setFields(old.id, { src_hash }); // imported before fingerprints: take today's as the baseline
  if (old && (!old.src_hash || old.src_hash === src_hash || ['removed', 'archived'].includes(old.status))) return null;
  if (!it.photos?.length) throw new Error('No photos found');
  const photos = await Promise.all(it.photos.slice(0, MAX_PHOTOS).map((p, i) => importPhoto(p, i + 1)));
  const fields = { ...Object.fromEntries(FIELDS.map(f => [f, it[f] ?? null])), boot: it.boot, boot_score: it.boot_score, photos,
    guessed: it.guessed, defaulted: it.defaulted, src_hash, enrich_v: ENRICH_V,
    // Seller-set WBW price survives source changes; otherwise it follows the source price.
    wbw_price: it.wbw_price ?? (old && Number(old.wbw_price) !== Number(old.price) ? old.wbw_price : it.price ?? null) };
  const id = old?.id ?? (await sql`insert into items (seller, boot, source, source_id, enriched)
    values (${seller}, ${it.boot}, ${it.source ?? null}, ${it.source_id ?? null}, true) returning id`)[0].id;
  const [row] = await setFields(id, old ? { ...fields, status: 'review' } : fields);
  return old ? { ...row, updated: true } : row;
}

// Moves items from this source that are no longer in the seller's current listings to Removed.
export async function syncSource(seller, source, sourceIds) {
  return (await sql`update items set status = 'removed', removed_at = now() where seller = ${seller} and source = ${source} and status not in ('removed', 'archived')
    and not (source_id = any(${sourceIds})) returning id`).length;
}

// Saving from the edit form = the seller verified every field (nothing guessed or defaulted any more).
export async function updateItems(seller, ids, p) {
  for (const [r] of await Promise.all(ids.map(id => sql`select id from items where seller = ${seller} and id = ${id}`)))
    if (r) await setFields(r.id, { ...p, guessed: [], defaulted: [] });
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
