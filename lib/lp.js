// List Perfectly export → BootLister listings. Private money columns are never read into an item.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { parseCsv } from './csv';
import { importOriginal, sourceRefreshPlan } from './optimize';
import { FIELDS, enrich } from './wbw';

export const LP_SOURCE = 'listperfectly';
export const LP_MARKETS = ['eBay', 'Etsy', 'Poshmark', 'Mercari', 'Tradesy', 'Amazon', 'Grailed', 'Facebook', 'Depop', 'Kidizen', 'Shopify', 'Vestiaire', 'Whatnot', 'Vinted', 'Reverb'];
export const LP_PRIVATE = ['Notes', 'Cost of Goods', 'Sold Price', 'Shipping Cost', 'Other Costs', 'Sold Date', 'Profit'];
// Western boot makers. A title that says boot counts when it names one of these, even without the word "cowboy".
export const COWBOY_MAKERS = ['tony lama', 'lucchese', 'justin', 'nocona', 'ariat', 'dan post', 'old gringo', 'corral', 'laredo', 'durango', 'abilene', 'boulet', 'rios of mercedes', 'anderson bean', 'olathe', 'larry mahan', 'double h', 'cinch', 'twisted x', 'tecovas', 'black jack', 'rocketbuster', 'stallion', 'liberty boot', 'luskey', 'ryon', 'imperial', 'laramie', 'cuadra', 'los altos', 'ferrini', 'hyer', 'acme', 'texas boot'];
const CLOSED = new Set(['sold', 'removed', 'archived']);
const SECRET_KEY = /^(notes|cost_of_goods|sold_price|shipping_cost|other_costs|sold_date|profit)$/i;
const BOOT_RE = /\b(boots?|booties?|bootie)\b/i;
const WESTERN_RE = /cowboy|cowgirl|western|roper|buckaroo|rodeo|stockman/i;
const MAKER_RE = new RegExp(`\\b(?:${[...COWBOY_MAKERS].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

// List Perfectly has no category. Keep a row when the title says boot and either says western or names a maker above.
export function isCowboyBoot(row) {
  const title = String(row?.Title ?? row?.title ?? '');
  if (!BOOT_RE.test(title)) return false;
  if (WESTERN_RE.test(title)) return true;
  return MAKER_RE.test(`${row?.Brand ?? row?.brand ?? ''}\n${title}`);
}

// Filename of a List Perfectly media URL. The path is stable when the title or price is edited.
function imageFile(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  try {
    const name = decodeURIComponent(new URL(s).pathname.split('/').filter(Boolean).pop() || '');
    return name;
  } catch { return ''; }
}

// List Perfectly's Date is when the listing was created. It stays put when the title, price, or
// sold state changes, and it is unique except when two rows share it. source_id is that Date.
// A shared Date also includes the SKU and the Main Image filename so those rows stay distinct.
// With no Date it falls back to SKU plus filename, then SKU, then the filename, then a sha1 of the title.
export function lpSourceId(record, shared = false) {
  const date = String(record.Date ?? '').trim();
  const sku = String(record.SKU ?? '').trim();
  const file = imageFile(record['Main Image']);
  if (date && !shared) return date;
  if (date) return [date, sku, file].filter(Boolean).join(' ');
  if (sku && file) return `${sku} ${file}`;
  if (sku) return sku;
  if (file) return file;
  return createHash('sha1').update(`\n${String(record.Title ?? '').trim()}`).digest('hex');
}

export function lpHash(item, extra) {
  const parts = FIELDS.map(f => String(item?.[f] ?? '').trim());
  parts.push((extra.photos ?? []).join('|'), extra.markets ?? '', extra.sold ? '1' : '0');
  // Only a museum listing with no usable group price. Other sellers keep the old fingerprint.
  if (extra.museum && extra.missing_group_price) parts.push('missing-group-price');
  return createHash('sha1').update(parts.join('\u0001')).digest('hex');
}

function money(v) {
  const n = String(v ?? '').replace(/[$,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(n) ? n : null;
}

// Dan Hoffenberg is the museum seller. sellers.name is the lowercase WBW slug (registration of
// "Dan Hoffenberg" yields dan-hoffenberg). display_name is the shop name an admin typed.
// There is no museum flag on the listing. Match this slug or that display name only.
export const MUSEUM_SELLER_SLUG = 'dan-hoffenberg';
export const MUSEUM_SELLER_DISPLAY = 'dan hoffenberg';
const normSlug = s => String(s ?? '').trim().toLowerCase();
const normDisplay = s => normSlug(s).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
export function isMuseumSeller(seller) {
  if (seller == null || seller === '') return false;
  if (typeof seller !== 'object') return normSlug(seller) === MUSEUM_SELLER_SLUG;
  const slug = normSlug(seller.name ?? seller.seller ?? '');
  return slug === MUSEUM_SELLER_SLUG || normDisplay(seller.display_name) === MUSEUM_SELLER_DISPLAY;
}

// Comments are the List Perfectly Notes column (also Comments / Comment if a file uses that header).
// Accepted, case-insensitive, one price in the whole field. $ is optional. Thousands commas allowed.
//   group price $X | group price: $X | group price = $X | group price is $X
//   group: $X | group = $X | group is $X
// X is 0–999999, no leading zeros, optional .cents (1–2 digits). A second phrase, a second $ amount
// on that line, a range (100-150, 100 to 150, 100 or 150, 100 and 150), or about/around/approx/~
// on that line is not a price. Description is not comments.
const GROUP_MONEY = String.raw`\$?\s*(?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d{1,2})?`;
const GROUP_PHRASE = new RegExp(String.raw`\b(?:group\s+price\b\s*(?:[:=]|is\b)?|group\s*(?:[:=]|is\b))\s*(${GROUP_MONEY})(?!\d)(?!\.\d)(?!,)`, 'gi');
const GROUP_RANGE = /\d\s*(?:-|–|—|to|or|and)\s*\$?\s*\d/i;
const GROUP_APPROX = /~|\b(?:about|around|approx(?:imately)?|roughly)\b/i;
const groupMoney = raw => {
  const n = String(raw ?? '').replace(/[$,\s]/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(n) || /^0\d/.test(n)) return null;
  return n;
};
export function parseGroupPrice(text) {
  const src = String(text ?? '').replace(/[\u00a0\u202f]/g, ' ');
  if (!src.trim()) return { price: null, missing: true };
  const hits = [];
  for (const m of src.matchAll(new RegExp(GROUP_PHRASE.source, 'gi'))) {
    const start = src.lastIndexOf('\n', m.index - 1) + 1;
    const end = src.indexOf('\n', m.index);
    const line = src.slice(start, end < 0 ? src.length : end);
    const dollars = line.match(/\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g) ?? [];
    const wroteDollar = /\$/.test(m[1]);
    if ((wroteDollar ? dollars.length !== 1 : dollars.length !== 0) || GROUP_RANGE.test(line) || GROUP_APPROX.test(line)) return { price: null, missing: true };
    const price = groupMoney(m[1]);
    if (!price) return { price: null, missing: true };
    hits.push(price);
  }
  return hits.length === 1 ? { price: hits[0], missing: false } : { price: null, missing: true };
}
function commentColumns(record) {
  const keys = Object.keys(record ?? {});
  const out = [];
  for (const want of ['notes', 'comments', 'comment']) {
    const key = keys.find(k => k.trim().toLowerCase() === want);
    if (!key) continue;
    const text = String(record[key] ?? '').trim();
    if (text) out.push(text);
  }
  return out;
}
// Group price replaces the spreadsheet Price only when one comment column says one price.
// Otherwise the spreadsheet price stays and the listing is flagged. Notes text is not returned.
function museumPrice(record, sale) {
  const columns = commentColumns(record);
  const parsed = columns.map(parseGroupPrice).map(p => p.price).filter(p => p != null);
  if (columns.length && parsed.length === columns.length && parsed.every(p => p === parsed[0])) return { price: parsed[0], missing_group_price: false };
  return { price: sale, missing_group_price: true };
}

// https only, no userinfo, no IP literals, no local names. The copy itself is safeFetch in the photo backfill.
export function lpPhotoUrl(src) {
  const s = String(src ?? '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password) return '';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host)) return '';
  return u.href;
}

function photosOf(record) {
  const raw = [record['Main Image'], ...String(record['Image Gallery'] ?? '').split(/\r?\n/)];
  const out = [], seen = new Set();
  for (const src of raw) {
    const url = lpPhotoUrl(src);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length === 30) break;
  }
  return out;
}

function quantityOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// One CSV object → a public listing, or { skip } when it has no title. Private columns are not copied.
export function mapLpRecord(record, shared = false, opts = {}) {
  const museum = !!opts.museum;
  const source_id = lpSourceId(record, shared);
  const title = String(record.Title ?? '').trim();
  const sold = /^sold$/i.test(String(record.SOLD ?? '').trim()) || quantityOf(record.Quantity) === 0;
  const markets = LP_MARKETS.filter(name => String(record[name] ?? '').trim()).join(', ');
  const photos = photosOf(record);
  if (!title) return { skip: true, source_id, sold, markets, photos, museum, missing_group_price: false };
  const priced = museum ? museumPrice(record, money(record.Price)) : { price: money(record.Price), missing_group_price: false };
  const raw = { title, price: priced.price, description: record.Description ?? '', photos, source: LP_SOURCE, source_id };
  const brand = String(record.Brand ?? '').trim(), color = String(record.Color ?? '').trim();
  const size = String(record.Size ?? '').trim(), material = String(record.Material ?? '').trim();
  if (brand) raw.brand = brand;
  if (color) raw.color = color;
  if (size) raw.size = size;
  if (material) raw.material = material;
  for (const k of Object.keys(raw)) if (SECRET_KEY.test(k)) throw new Error('Refusing to store a private List Perfectly column.');
  return { source_id, sold, markets, photos, raw, museum, missing_group_price: priced.missing_group_price, notCowboy: !isCowboyBoot(record) };
}

export function mapLpCsv(text, opts = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  if (!keys.includes('Title') || !keys.includes('SKU') || !keys.includes('Price')) throw new Error('That file is not a List Perfectly export.');
  const dates = new Map();
  for (const r of rows) {
    const d = String(r.Date ?? '').trim();
    if (d) dates.set(d, (dates.get(d) ?? 0) + 1);
  }
  return rows.map(r => mapLpRecord(r, (dates.get(String(r.Date ?? '').trim()) ?? 0) > 1, opts));
}

export function mappedItem(record, opts = {}) {
  const m = mapLpRecord(record, false, opts);
  if (!m || m.skip) return m;
  const item = enrich(m.raw);
  return { ...m, item, hash: lpHash(item, m) };
}

const keep = v => v == null || v === '' ? null : v;

// New source values, except fields the seller already verified (or a WBW price they set themselves).
export function mergeLp(old, m) {
  const verified = new Set(old?.verified ?? []);
  const item = m.item ?? {};
  const fields = {};
  for (const f of FIELDS) fields[f] = verified.has(f) ? keep(old[f]) : keep(item[f]);
  if (!verified.has('wbw_price')) {
    const priced = old?.wbw_price != null && Number(old.wbw_price) !== Number(old.price);
    fields.wbw_price = priced ? keep(old.wbw_price) : (keep(item.wbw_price) ?? keep(item.price));
  }
  fields.guessed = (item.guessed ?? []).filter(f => !verified.has(f));
  const urls = (m.photos ?? []).join('\n');
  if (old?.src_photos && old.src_photos === urls) fields.photos = old.photos ?? [];
  else { fields.photos = m.photos ?? []; fields.src_photos = urls; }
  fields.markets = m.markets || null;
  fields.boot = item.boot ?? 'unsure';
  fields.boot_score = item.boot_score ?? 0;
  fields.src_hash = m.hash;
  if (m.museum) fields.missing_group_price = !!m.missing_group_price;
  const snap = importOriginal(m.raw ?? item, fields.photos, null);
  const refresh = sourceRefreshPlan(old, m.hash, snap);
  if (refresh) {
    fields.opt_original = refresh.opt_original;
    if (refresh.opt_proposal === null) fields.opt_proposal = null;
    if (refresh.opt_applied === null) fields.opt_applied = null;
    if (refresh.style_ref === null) fields.style_ref = null;
  }
  for (const k of Object.keys(fields)) if (SECRET_KEY.test(k)) throw new Error('Refusing to store a private List Perfectly column.');
  return fields;
}

const stamp = () => new Date().toISOString();

// Diff one upload against listings already stored for this seller. Does not mark rows missing from the file
// (that is the whole file, applied once at the end).
export function planLp(existing, mapped) {
  const byId = new Map((existing ?? []).map(row => [String(row.source_id), row]));
  const seen = new Set();
  const inserts = [], updates = [];
  const summary = { new: 0, updated: 0, sold: 0, notCowboy: 0, skipped: 0, missingGroupPrice: 0 };
  for (const m of mapped) {
    if (seen.has(m.source_id)) { summary.skipped++; continue; }
    seen.add(m.source_id);
    if (m.skip) { summary.skipped++; continue; }
    // Still in the file, but not a cowboy boot. Do not create it, and do not mark a stored copy sold.
    if (m.notCowboy) { summary.notCowboy++; continue; }
    if (m.museum && m.missing_group_price && !m.sold) summary.missingGroupPrice++;
    const old = byId.get(m.source_id);
    if (!old) {
      if (m.sold) { summary.skipped++; continue; }
      inserts.push({ source_id: m.source_id, fields: { ...mergeLp({}, m), status: 'review' } });
      summary.new++;
      continue;
    }
    if (m.sold) {
      if (old.status === 'review' || old.status === 'published') {
        updates.push({ id: old.id, fields: { ...mergeLp(old, m), status: 'pending', status_at: stamp() } });
        summary.sold++;
      } else summary.skipped++;
      continue;
    }
    if (CLOSED.has(old.status)) { summary.skipped++; continue; }
    const same = old.src_hash && old.src_hash === m.hash;
    if (same && old.status !== 'pending') { summary.skipped++; continue; }
    updates.push({ id: old.id, fields: { ...mergeLp(old, m), status: 'review', status_at: stamp(), changed_at: stamp(), approved_at: null, approved_by: null } });
    summary.updated++;
  }
  return { inserts, updates, summary };
}

// Rows from an earlier LP import that this file no longer contains, still for sale here.
export function missingFromLp(items, sourceIds) {
  const seen = new Set((sourceIds ?? []).map(id => String(id)));
  return (items ?? []).filter(i => (i.status === 'review' || i.status === 'published') && !seen.has(String(i.source_id))).map(i => i.id);
}

export async function runLpImport(csv, db, seller) {
  const mapped = mapLpCsv(csv, { museum: isMuseumSeller(seller) });
  if (!mapped.length) throw new Error('No listings found in that CSV.');
  const prepared = [];
  for (const m of mapped) {
    if (m.skip || m.notCowboy) { prepared.push(m); continue; }
    const item = await db.enrich(m.raw);
    prepared.push({ ...m, item, hash: lpHash(item, m) });
  }
  const existing = await db.load(prepared.map(m => m.source_id));
  const plan = planLp(existing, prepared);
  for (const row of plan.inserts) await db.insert(row.source_id, row.fields);
  for (const row of plan.updates) await db.update(row.id, row.fields);
  return { ...plan.summary, sourceIds: prepared.map(m => m.source_id) };
}
