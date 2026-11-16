// Import → WBW export pipeline. Client-safe (the inventory page imports it). No network.
// Every source already lands on the same item fields (lib/wbw.js enrich + source readers). This file adds the WBW fields
// the Sell-a-pair CSV does not carry, the pre-drop readiness status, the full per-seller export, and a fill-rate summary.
// Rule: original listing data and seller-stated policies only. A field nobody stated stays blank.
import { csvCell } from './csv';
import { CSV, exportRecord } from './export';
import { needsCheck } from './publish';
import { exportReadiness } from './readiness';
import { VIDEO_TOOL_LABEL } from './video-placeholder';

const on = v => v === true || /^(on|yes|true)$/i.test(String(v ?? '').trim());
const str = v => String(v ?? '').trim();
const text = item => `${item?.title ?? ''}\n${item?.description ?? ''}`;

// "OBO" / "or best offer" → OBO; "firm" next to price wording → Firm. Only when the listing says so.
export function priceType(item) {
  const t = text(item);
  if (/\bOBO\b|\bor best offers?\b|\bbest offer\b|\boffers? (welcome|accepted)\b/i.test(t)) return 'OBO';
  if (/\b(price (is )?firm|firm (on )?(the )?price|\d\s*firm)\b/i.test(t)) return 'Firm';
  return '';
}
// Yes when the listing says custom made / made to order / bespoke (or condition was set to Custom Made). Never "No".
export function customMade(item) {
  if (/^custom made$/i.test(str(item?.condition))) return 'Yes';
  return /\bcustom[- ]made\b|\bmade[- ]to[- ]order\b|\bbespoke\b|\bcustom[- ]ordered\b/i.test(text(item)) ? 'Yes' : '';
}
// A "Seller notes: …" or "Notes: …" line in the listing. Nothing is written for the seller.
export function sellerNotes(item) {
  return str(String(item?.description ?? '').match(/^\s*(?:seller(?:'s)? )?notes?\s*:\s*(.+)$/im)?.[1]);
}
// Seller-level store policies (intake → seller row). Payment is stored as display text ("PayPal, Venmo").
export function sellerPolicies(seller = {}) {
  return { shipping: str(seller.shipping_policy), payment: str(seller.payment_methods), returns: str(seller.return_policy) };
}

// WBW listing fields counted for fill rate (photos and the text fields from wbw-listing-sample.md). website_url only off-marketplace.
export const WBW_FIELDS = [
  ['title', 'Title'], ['description', 'Description'], ['wbw_price', 'Price'], ['price_type', 'Price type'], ['size', 'Size'], ['width', 'Width'],
  ['sized_for', 'Sized for'], ['condition', 'Condition'], ['material_type', 'Material type'], ['material', 'Material / skin'], ['made_in', 'Where made'],
  ['color', 'Color'], ['brand', 'Maker / brand'], ['id_text', 'Model / style'], ['custom_made', 'Custom made'], ['material_cut', 'Cut'],
  ['sole', 'Sole'], ['heel', 'Heel'], ['toe', 'Toe'], ['keywords', 'Keywords'], ['seller_notes', 'Seller notes'],
  ['sole_length', 'Sole length'], ['sole_width', 'Sole width'], ['heel_height', 'Heel height'], ['shaft_circ', 'Shaft circumference'],
  ['shaft_height', 'Shaft height'], ['shipping', 'Shipping'], ['payment', 'Payment'], ['photos', 'Photos'],
];

export const FULL_CSV = { ...CSV, price_type: 'Price type', custom_made: 'Custom made', seller_notes: 'Seller notes', shipping: 'Shipping',
  payment: 'Payment options', returns: 'Return policy', video: 'Video', export_status: 'Export status', missing_fields: 'Missing fields' };

const filled = v => Array.isArray(v) ? v.length > 0 : str(v) !== '';

// Pre-drop stage. Photo optimization (names, alt text, SEO) always runs at import; extra description info and video
// are the seller's admin-set opt-ins (sellers.extra_text / sellers.video_opt, default off).
// status: ready | needs-approval | needs-info | not-optimized. missing = WBW fields still blank.
export function prepareForExport(item, ctx = {}) {
  const seller = ctx.seller ?? {};
  const base = exportRecord(item, ctx);
  const pol = sellerPolicies(seller);
  const record = { ...base, price_type: priceType(item), custom_made: customMade(item), seller_notes: sellerNotes(item),
    shipping: pol.shipping, payment: pol.payment, returns: pol.returns,
    // Video tool is built elsewhere. The slot stays empty; the note says whether this seller opted in.
    video: '', video_slot: on(seller.video_opt) ? `${VIDEO_TOOL_LABEL} (seller opted in)` : 'off' };
  const optimized = item?.opt_applied?.media === 'lens' || (typeof item?.opt_applied === 'string' && item.opt_applied.includes('"lens"'));
  const blockers = exportReadiness(item).missing;
  const missing = WBW_FIELDS.filter(([k]) => !filled(record[k])).map(([, l]) => l);
  const status = !optimized ? 'not-optimized' : blockers.length ? 'needs-info' : needsCheck(item) ? 'needs-approval' : 'ready';
  return { record: { ...record, export_status: status, missing_fields: missing }, status, blockers, missing };
}

// Share of rows with each WBW field filled, plus the overall average. rows = prepareForExport(...).record.
export function fillRate(records) {
  const n = records.length || 1;
  const fields = WBW_FIELDS.map(([k, label]) => ({ key: k, label, filled: records.filter(r => filled(r[k])).length, rate: records.filter(r => filled(r[k])).length / n }));
  const overall = fields.reduce((a, f) => a + f.rate, 0) / fields.length;
  return { rows: records.length, overall, fields };
}
export const fillSummary = s => `${s.rows} listing${s.rows === 1 ? '' : 's'}, ${Math.round(s.overall * 100)}% of WBW fields filled. Lowest: ${
  [...s.fields].sort((a, b) => a.rate - b.rate).slice(0, 5).map(f => `${f.label} ${Math.round(f.rate * 100)}%`).join(', ')}.`;

// Per-seller full export: the Sell-a-pair columns unchanged, then the extra WBW fields and the readiness columns.
export function toFullCsv(items, ctx = {}) {
  const records = items.map(i => prepareForExport(i, ctx).record);
  const keys = Object.keys(FULL_CSV);
  const csv = [Object.values(FULL_CSV), ...records.map(r => keys.map(k => r[k]))].map(line => line.map(csvCell).join(',')).join('\r\n');
  return { csv, summary: fillRate(records) };
}
