// List Perfectly export → BootLister listings. Private money columns are never read into an item.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { parseCsv } from './csv';
import { FIELDS, enrich } from './wbw';

export const LP_SOURCE = 'listperfectly';
export const LP_MARKETS = ['eBay', 'Etsy', 'Poshmark', 'Mercari', 'Tradesy', 'Amazon', 'Grailed', 'Facebook', 'Depop', 'Kidizen', 'Shopify', 'Vestiaire', 'Whatnot', 'Vinted', 'Reverb'];
export const LP_PRIVATE = ['Notes', 'Cost of Goods', 'Sold Price', 'Shipping Cost', 'Other Costs', 'Sold Date', 'Profit'];
const CLOSED = new Set(['sold', 'removed', 'archived']);
const SECRET_KEY = /^(notes|cost_of_goods|sold_price|shipping_cost|other_costs|sold_date|profit)$/i;

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
  return createHash('sha1').update(parts.join('\u0001')).digest('hex');
}

function money(v) {
  const n = String(v ?? '').replace(/[$,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(n) ? n : null;
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
export function mapLpRecord(record, shared = false) {
  const source_id = lpSourceId(record, shared);
  const title = String(record.Title ?? '').trim();
  const sold = /^sold$/i.test(String(record.SOLD ?? '').trim()) || quantityOf(record.Quantity) === 0;
  const markets = LP_MARKETS.filter(name => String(record[name] ?? '').trim()).join(', ');
  const photos = photosOf(record);
  if (!title) return { skip: true, source_id, sold, markets, photos };
  const raw = { title, price: money(record.Price), description: record.Description ?? '', photos, source: LP_SOURCE, source_id };
  const brand = String(record.Brand ?? '').trim(), color = String(record.Color ?? '').trim();
  const size = String(record.Size ?? '').trim(), material = String(record.Material ?? '').trim();
  if (brand) raw.brand = brand;
  if (color) raw.color = color;
  if (size) raw.size = size;
  if (material) raw.material = material;
  for (const k of Object.keys(raw)) if (SECRET_KEY.test(k)) throw new Error('Refusing to store a private List Perfectly column.');
  return { source_id, sold, markets, photos, raw };
}

export function mapLpCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  if (!keys.includes('Title') || !keys.includes('SKU') || !keys.includes('Price')) throw new Error('That file is not a List Perfectly export.');
  const dates = new Map();
  for (const r of rows) {
    const d = String(r.Date ?? '').trim();
    if (d) dates.set(d, (dates.get(d) ?? 0) + 1);
  }
  return rows.map(r => mapLpRecord(r, (dates.get(String(r.Date ?? '').trim()) ?? 0) > 1));
}

export function mappedItem(record) {
  const m = mapLpRecord(record);
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
  const summary = { new: 0, updated: 0, sold: 0, skipped: 0 };
  for (const m of mapped) {
    if (seen.has(m.source_id)) { summary.skipped++; continue; }
    seen.add(m.source_id);
    if (m.skip) { summary.skipped++; continue; }
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

export async function runLpImport(csv, db) {
  const mapped = mapLpCsv(csv);
  if (!mapped.length) throw new Error('No listings found in that CSV.');
  const prepared = [];
  for (const m of mapped) {
    if (m.skip) { prepared.push(m); continue; }
    const item = await db.enrich(m.raw);
    prepared.push({ ...m, item, hash: lpHash(item, m) });
  }
  const existing = await db.load(prepared.map(m => m.source_id));
  const plan = planLp(existing, prepared);
  for (const row of plan.inserts) await db.insert(row.source_id, row.fields);
  for (const row of plan.updates) await db.update(row.id, row.fields);
  return { ...plan.summary, sourceIds: prepared.map(m => m.source_id) };
}
