// Mock WBW backend. Replace this file only when connecting to the real WBW.
import { neon } from '@neondatabase/serverless';
import { put, del } from '@vercel/blob';
import { createHash } from 'crypto';
import { brandName, findBrand, findMaterial } from './vocab';
import { sha256 } from './session';

let db;
const conn = () => db ??= neon(process.env.DATABASE_URL);
const sql = (...a) => conn()(...a);
// Statuses: review (Newly imported) → published (Exported) ; pending (gone from the source) → sold (seller confirms, or after
// 30 days) ; removed (seller pulled it) → archived (after 30 days). status_at = when the status last changed.
const STATUS = { publish: 'published', remove: 'removed', restore: 'review', sold: 'sold' };
const CLOSED = ['removed', 'archived', 'sold'];
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
  const title = it.title ?? '', text = `${title}\n${it.description ?? ''}\n${it.category ?? ''}`; // category: source's own tags (Depop)
  if (BELT.test(`${title} ${it.category ?? ''}`) && !BOOT_WORD.test(title)) return { boot: 'belt', boot_score: 0 };
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

// Fills WBW fields from the listing. `guessed` = fields read from free text (the seller should verify them).
function enrich(raw) {
  const lab = labeled(raw.description);
  if (lab.wbw_price) lab.wbw_price = lab.wbw_price.replace(/[^\d.]/g, '') || undefined;
  if (lab.sized_for) lab.sized_for = gender(lab.sized_for);
  const it = { ...raw, ...Object.fromEntries(Object.entries(lab).filter(([, v]) => v)) };
  const text = `${it.title}\n${it.description ?? ''}`, find = re => text.match(re)?.[1];
  const sz = `${lab.size ?? ''} ${it.title} ${it.size ?? ''}`.match(/\b(\d{1,2}(?:\.5)?)[ -]?([2-4]E|EEEE|EEE|EE|[A-EMW])\b/) || `${it.size ?? ''}`.match(/(\d{1,2}(?:\.5)?)/)
    || text.match(/\bsize:?[ \t]*(\d{1,2}(?:\.5)?)\b/i);
  const mat = findMaterial(text);
  // Brand: the source's (standardised), else a known maker named in the listing, else "Custom" if the title says custom.
  const brand = it.brand ? brandName(it.brand) : findBrand(it.title)?.name || findBrand(text)?.name || (/\bcustom\b/i.test(it.title) ? 'Custom' : null);
  const noBrand = brand ? text.replace(findBrand(brand)?.re ?? brand, '') : text; // so "Black Jack" isn't read as a color
  const who = (it.title.match(GENDER) || text.match(GENDER))?.[1];
  const width = lab.width || sz?.[2] || it.width || null;
  const out = {
    ...it,
    brand,
    size: sz?.[1] ?? it.size ?? null,
    width, // left blank if the listing doesn't say (shown red as a heads-up, not required)
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
  // Given (not flagged) = from the source's own fields or a "Label: value" line. The default "Men" isn't flagged either;
  // genderDefaulted lets a seller's own default replace it.
  const given = f => lab[f] || raw[f] || (f === 'sized_for' && !who);
  return { ...out, ...classify(out), genderDefaulted: !it.sized_for && !who, guessed: [...GUESSED, 'size'].filter(f => out[f] && !given(f)) };
}

let ready;
const init = () => ready ??= sql`create table if not exists items (
  id serial primary key, seller text not null, status text not null default 'review', boot text not null,
  source text, source_id text, title text, price numeric, description text, size text, condition text, brand text,
  photos text[] not null default '{}', created_at timestamptz default now(), unique (seller, source, source_id))`
  .then(() => conn().query(`alter table items add column if not exists removed_at timestamptz, add column if not exists status_at timestamptz,
    add column if not exists changed_at timestamptz,
    add column if not exists enrich_v int default 0, add column if not exists guessed text[] default '{}', add column if not exists src_hash text,
    add column if not exists boot_score real, add column if not exists source_url text,
    ${NEW_COLS.map(c => `add column if not exists ${c} ${NUMERIC.includes(c) ? 'numeric' : 'text'}`).join(', ')}`))
  .then(() => sql`create table if not exists sellers (name text primary key, display_name text, contact text, email text, phone text,
    location text, website text, fb_profile text, notes text, created_at timestamptz default now())`)
  .then(() => sql`alter table sellers add column if not exists sync text default 'off', add column if not exists terms text, add column if not exists defaults text,
    add column if not exists login_hash text, add column if not exists login_salt text`)
  .then(() => sql`update items set status_at = coalesce(removed_at, now()) where status in ('removed', 'pending') and status_at is null`)
  .then(() => sql`update items set seller = lower(trim(seller)) where seller <> lower(trim(seller))`)
  .then(async () => { // re-run enrich() on items imported under older rules: only guessed fields are re-derived; source/seller values and WBW price kept
    const rows = await sql`select * from items where coalesce(enrich_v, 0) < ${ENRICH_V}`;
    const sellers = Object.fromEntries((await sql`select * from sellers`).map(s => [s.name, s]));
    for (let i = 0; i < rows.length; i += 25) await Promise.all(rows.slice(i, i + 25).map(r => {
      const e = enrichFor({ ...r, ...Object.fromEntries((r.guessed ?? []).filter(f => f !== 'size').map(f => [f, null])) }, sellers[r.seller]);
      return setFields(r.id, { ...e, wbw_price: e.wbw_price ?? r.wbw_price ?? r.price, enrich_v: ENRICH_V });
    }));
  })
  .catch(e => { ready = null; throw e; }); // retry setup on the next request instead of caching the failure
const ENRICH_V = 9; // bump to re-run enrich() over existing items after parsing changes
// Fields enrich() may infer from free text (flagged for the seller to verify).
const GUESSED = ['brand', 'sized_for', 'width', 'material_type', 'material', 'made_in', 'color', 'sole', 'heel', 'toe'];

// Writes the given columns of `it` (FIELDS plus internal ones) to one item — only if it belongs to `seller`, when given.
const WRITABLE = [...FIELDS, 'boot', 'boot_score', 'status', 'photos', 'enrich_v', 'guessed', 'src_hash', 'source_url', 'status_at', 'changed_at'];
const setFields = (id, it, seller) => {
  const keys = WRITABLE.filter(f => it[f] !== undefined), vals = [id, ...keys.map(k => it[k] === '' ? null : it[k])];
  if (!keys.length) return [];
  const scope = seller ? ` and seller = $${vals.push(seller)}` : '';
  return conn().query(`update items set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1${scope} returning *`, vals);
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

// After 30 days: Pending sold → Sold, Removed → Archived.
export async function getItems(seller, status) {
  await init();
  await sql`update items set status = case status when 'pending' then 'sold' else 'archived' end, status_at = now()
    where seller = ${seller} and status in ('pending', 'removed') and status_at < now() - interval '30 days'`;
  return sql`select * from items where seller = ${seller} and status = ${status} order by created_at desc`;
}

// Sellers: WBW seller name (key, lowercase) + details. A seller needs details before any import (pull) can run for them.
export const SELLER_FIELDS = ['display_name', 'contact', 'email', 'phone', 'location', 'website', 'fb_profile', 'sync', 'notes', 'terms', 'defaults'];

// Seller listing-style rules, one "left = right" per line. terms: seller shorthand → meaning (used only to read the listing;
// the listing text itself is kept as written). defaults: field = value, used when the listing doesn't say.
const pairs = txt => (txt ?? '').split('\n').map(l => l.split('=').map(x => x.trim())).filter(([a, b]) => a && b);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function enrichFor(raw, s) {
  const terms = pairs(s?.terms), expand = t => terms.reduce((x, [a, b]) => x?.replace(new RegExp(`(?<![\\w])${esc(a)}(?![\\w])`, 'gi'), b), t);
  const e = enrich({ ...raw, title: expand(raw.title) ?? '', description: expand(raw.description) });
  for (const [f, v] of pairs(s?.defaults)) { const k = f.toLowerCase().replace(/ /g, '_'); if (FIELDS.includes(k) && (!e[k] || (k === 'sized_for' && e.genderDefaulted))) e[k] = v; }
  return { ...e, title: raw.title, description: raw.description };
}
const sellerRow = async name => (await sql`select * from sellers where name = ${name}`)[0];

// Sellers — with details if entered — and their item counts; `only` = just that seller (a seller's own login).
// Login hashes never leave the server; has_login says whether one is set.
export async function getSellers(only) {
  await init();
  const rows = await sql`select coalesce(s.name, i.seller) as seller, s.*, coalesce(i.review, 0) as review, coalesce(i.active, 0) as active
    from sellers s full join (select seller, count(*) filter (where status = 'review')::int as review,
      count(*) filter (where status in ('review', 'published', 'pending'))::int as active from items group by seller) i on i.seller = s.name
    order by 1`;
  return rows.filter(r => !only || r.seller === only).map(({ login_hash, login_salt, ...r }) => ({ ...r, has_login: !!login_hash }));
}

// Seller logins: password stored as a salted hash, set by the team in Seller settings (login_password).
export async function checkSellerLogin(name, password) {
  await init();
  const s = await sellerRow(name);
  return !!(s?.login_hash && password && s.login_hash === await sha256(`${s.login_salt}:${password}`));
}

export async function saveSeller(p) {
  await init();
  const name = p.name?.trim().toLowerCase();
  if (!name || !p.display_name?.trim()) throw new Error('WBW seller name and display name are required.');
  // Renamed (rename_from = old name): move the seller record and their items to the new name.
  const from = p.rename_from?.trim().toLowerCase();
  if (from && from !== name) {
    if ((await sql`select 1 from sellers where name = ${name}`).length) throw new Error(`There's already a seller named "${name}".`);
    await sql`update sellers set name = ${name} where name = ${from}`;
    await sql`update items set seller = ${name} where seller = ${from}`;
  }
  const vals = SELLER_FIELDS.map(f => p[f]?.trim() || null);
  const [{ login_hash, login_salt, ...row }] = await conn().query(`insert into sellers (name, ${SELLER_FIELDS}) values ($1, ${SELLER_FIELDS.map((_, i) => `$${i + 2}`)})
    on conflict (name) do update set ${SELLER_FIELDS.map(f => `${f} = excluded.${f}`)} returning *`, [name, ...vals]);
  if (p.login_password?.trim()) { // set or change the seller's login
    const salt = crypto.randomUUID();
    await sql`update sellers set login_salt = ${salt}, login_hash = ${await sha256(`${salt}:${p.login_password.trim()}`)} where name = ${name}`;
  }
  return { ...row, has_login: !!(login_hash || p.login_password?.trim()) };
}

// Deletes a seller's record — only when they have no items left (move or delete those first).
export async function deleteSeller(name) {
  await init();
  if ((await sql`select 1 from items where seller = ${name} limit 1`).length) throw new Error('This seller still has items — move or delete them first.');
  await sql`delete from sellers where name = ${name}`;
  return { ok: true };
}

// Imports (pulls) start by listing what the seller already has, so that's where seller details are required.
export async function getSourceIds(seller, source) {
  await init();
  if (!(await sellerRow(seller))) throw new Error(`Add details for seller "${seller}" on the inventory page before importing for them.`);
  return (await sql`select source_id from items where seller = ${seller} and source = ${source}`).map(r => r.source_id);
}

// Fingerprint of what the source said (not the seller's edits), to tell real source changes from re-imports.
const SOURCE_KEYS = ['title', 'price', 'description', 'condition', 'brand', 'size', 'sized_for', 'color', 'material'];
const fingerprint = raw => createHash('sha1').update(JSON.stringify([...SOURCE_KEYS.map(k => String(raw[k] ?? '').trim()), (raw.photos ?? []).length])).digest('hex'); // photo count, not URLs (FB's change daily)

// New item → insert. Already imported → ignored, unless the source listing changed since — or it was pending sold and is
// back on sale — then it's refreshed and sent back to Newly imported, marked changed, for the seller to review.
export async function createItem(seller, raw) {
  await init();
  const it = enrichFor(raw, await sellerRow(seller)), src_hash = fingerprint(raw);
  const [old] = it.source_id ? await sql`select * from items where seller = ${seller} and source = ${it.source ?? null} and source_id = ${it.source_id}` : [];
  // Imported before fingerprints / item links: take today's as the baseline and fill in the link.
  if (old && (!old.src_hash || !old.source_url)) await setFields(old.id, { src_hash: old.src_hash ?? src_hash, source_url: old.source_url ?? it.source_url });
  if (old && old.status !== 'pending' && (!old.src_hash || old.src_hash === src_hash || CLOSED.includes(old.status))) return null;
  if (!it.photos?.length) throw new Error('No photos found');
  const photos = await Promise.all(it.photos.slice(0, MAX_PHOTOS).map((p, i) => importPhoto(p, i + 1)));
  const fields = { ...Object.fromEntries(FIELDS.map(f => [f, it[f] ?? null])), boot: it.boot, boot_score: it.boot_score, photos,
    guessed: it.guessed, src_hash, source_url: it.source_url, enrich_v: ENRICH_V,
    // Seller-set WBW price survives source changes; otherwise it follows the source price.
    wbw_price: it.wbw_price ?? (old && Number(old.wbw_price) !== Number(old.price) ? old.wbw_price : it.price ?? null) };
  const id = old?.id ?? (await sql`insert into items (seller, boot, source, source_id)
    values (${seller}, ${it.boot}, ${it.source ?? null}, ${it.source_id ?? null}) returning id`)[0].id;
  const [row] = await setFields(id, old ? { ...fields, status: 'review', status_at: new Date(), changed_at: new Date() } : fields);
  return old ? { ...row, updated: true } : row;
}

// Listings no longer at the source → Pending sold (the seller confirms, or they become Sold after 30 days).
export async function syncSource(seller, source, sourceIds) {
  return (await sql`update items set status = 'pending', status_at = now() where seller = ${seller} and source = ${source}
    and status in ('review', 'published') and not (source_id = any(${sourceIds})) returning id`).length;
}

// Saving from the edit form = the seller verified every field (and reviewed any change from the source).
export async function updateItems(seller, ids, p) {
  await Promise.all(ids.map(id => setFields(id, { ...p, guessed: [], changed_at: null }, seller)));
}

// Deletes items for good, with any photos copied to Blob storage.
export async function deleteItems(seller, ids) {
  const rows = await sql`delete from items where seller = ${seller} and id = any(${ids}) returning photos`;
  const copied = rows.flatMap(r => r.photos).filter(p => p.includes('blob.vercel-storage.com'));
  if (copied.length) await del(copied).catch(() => {}); // photo cleanup is best-effort
  return rows.length;
}

// Moves items to another seller (items that seller already has from the same listing are left where they are).
export async function moveItems(seller, ids, to) {
  to = to?.trim().toLowerCase();
  if (!to) throw new Error('Enter the seller to move to.');
  return (await sql`update items i set seller = ${to} where i.seller = ${seller} and i.id = any(${ids})
    and not exists (select 1 from items o where o.seller = ${to} and o.source = i.source and o.source_id = i.source_id) returning id`).length;
}

// Bulk price changes apply to the WBW price.
export async function lowerPrice(seller, ids, percent = 0, amount = 0) {
  await sql`update items set wbw_price = greatest(round(coalesce(wbw_price, price) * (1 - ${percent}::numeric / 100) - ${amount}::numeric, 2), 0)
    where seller = ${seller} and id = any(${ids})`;
}

export async function setStatus(seller, ids, action) {
  if (!STATUS[action]) throw new Error(`Unknown action: ${action}`);
  await sql`update items set status = ${STATUS[action]}, status_at = now() where seller = ${seller} and id = any(${ids})`;
}
