// WBW sync. BootLister cannot write to WBW, so "sync" = keep each seller's BootLister inventory in step with their
// primary inventory tool (re-import / re-scan), then hand Dan a delta file to apply on WBW by hand.
// items.wbw_state = what was last applied on WBW (set when Dan clicks "Mark applied"). Pure functions; no network.
import { csvCell } from './csv';
import { FULL_CSV, prepareForExport } from './pipeline';

// Fields compared for "details changed". Price is reported separately.
export const SYNC_KEYS = ['title', 'description', 'brand', 'sized_for', 'size', 'width', 'condition', 'material_type', 'material', 'material_cut',
  'made_in', 'color', 'keywords', 'sole_length', 'sole_width', 'heel_height', 'shaft_circ', 'shaft_height', 'sole', 'heel', 'toe', 'id_text'];
export const PRIMARY_SOURCES = ['depop', 'facebook', 'ebay', 'poshmark', 'csv', 'listperfectly', 'website'];
const GONE = ['pending', 'sold', 'removed', 'archived'];
const s = v => String(v ?? '').trim();
const json = v => { if (v == null || v === '') return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; };
const price = it => { const n = Number(it?.wbw_price ?? it?.price); return Number.isFinite(n) ? n : null; };

// Snapshot stored when Dan marks a row applied on WBW.
export function syncState(item) {
  return { status: GONE.includes(item.status) ? 'sold' : 'listed', price: price(item), photos: (item.photos ?? []).length,
    ...Object.fromEntries(SYNC_KEYS.map(k => [k, s(item[k])])) };
}

// Which sources count as the seller's primary tool. 'website' = any store host (Shopify/Wix…), csv covers List Perfectly too.
export function fromPrimary(item, primary) {
  const p = s(primary).toLowerCase();
  if (!p) return true;
  if (p === 'website') return !['depop', 'facebook', 'ebay', 'poshmark', 'csv', 'listperfectly'].includes(item.source);
  if (p === 'csv' || p === 'listperfectly') return item.source === 'csv' || item.source === 'listperfectly';
  return item.source === p;
}

// One row per item that WBW needs to change. action: new | price | update | mark-sold. held = changed at source, waiting for approval.
export function syncDelta(items, { primary } = {}) {
  const out = [];
  for (const it of items) {
    if (!fromPrimary(it, primary)) continue;
    const last = json(it.wbw_state);
    const gone = GONE.includes(it.status);
    if (!last) {
      if (it.status === 'published') out.push({ id: it.id, action: 'new', item: it });
      continue;
    }
    if (gone) { if (last.status !== 'sold') out.push({ id: it.id, action: 'mark-sold', item: it, reason: it.status === 'pending' ? 'gone from source' : it.status }); continue; }
    if (last.status === 'sold') { if (it.status === 'published') out.push({ id: it.id, action: 'new', item: it, reason: 'back for sale' }); continue; }
    if (it.status !== 'published') { out.push({ id: it.id, action: 'held', item: it, reason: it.changed_at ? 'changed at source, needs approval' : 'needs approval' }); continue; }
    const changed = SYNC_KEYS.filter(k => s(it[k]) !== s(last[k]));
    if ((it.photos ?? []).length !== last.photos) changed.push('photos');
    const priceMoved = price(it) !== last.price;
    if (priceMoved || changed.length) out.push({ id: it.id, action: changed.length ? 'update' : 'price', item: it, changed, from_price: last.price, to_price: price(it) });
  }
  return out;
}

export const deltaCounts = rows => rows.reduce((c, r) => ({ ...c, [r.action]: (c[r.action] ?? 0) + 1 }), { new: 0, price: 0, update: 0, 'mark-sold': 0, held: 0 });

// Delta file for WBW: Action, what changed, then the full WBW record (new/update) or just enough to find the pair (mark-sold).
export function deltaCsv(rows, ctx = {}) {
  const keys = Object.keys(FULL_CSV);
  const head = ['Action', 'Changed', 'Old price', ...Object.values(FULL_CSV)];
  const lines = rows.filter(r => r.action !== 'held').map(r => {
    const rec = prepareForExport(r.item, ctx).record;
    const changed = r.action === 'mark-sold' ? r.reason : r.action === 'new' ? (r.reason || 'new listing') : [...(r.changed ?? []), ...(r.from_price !== r.to_price ? ['price'] : [])].join(', ');
    return [r.action, changed, r.from_price ?? '', ...keys.map(k => rec[k])];
  });
  return [head, ...lines].map(l => l.map(csvCell).join(',')).join('\r\n');
}

// Scheduled sync is designed but OFF. It only runs when SYNC_CRON_ENABLED=1 and a CRON_SECRET bearer matches, and there is
// no crons entry in vercel.json. Hobby: cron at most once a day (±59 min), 300 s per function. Pro: per-minute, 800 s max.
export function cronAllowed(req, env = process.env) {
  if (env.SYNC_CRON_ENABLED !== '1') return { ok: false, reason: 'Scheduled sync is off (SYNC_CRON_ENABLED is not 1).' };
  if (!env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return { ok: false, reason: 'Not authorized.' };
  return { ok: true };
}
