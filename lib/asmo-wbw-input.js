// Build the asmoWBW input-contract JSON from an items row, a sellers row, and optional photo sidecars.
// Listing title, description, price, and size are copied as-is and are never written back.
// This module is data-only: it does not name photos or call asmoWBW.
import { acceptToken } from './model';

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

const has = v => v != null && String(v).trim() !== '';
const text = v => (v == null ? null : String(v));
const arr = v => (Array.isArray(v) ? v : []);

export function publicSeller(seller) {
  const s = seller && typeof seller === 'object' ? seller : { name: seller };
  return {
    name: text(s.name ?? s.seller) || '',
    display_name: has(s.display_name) ? String(s.display_name).trim() : null,
    location: has(s.location) ? String(s.location).trim() : null,
    website: has(s.website) ? String(s.website).trim() : null,
    brand_context: has(s.brand_context) ? String(s.brand_context).trim() : null,
  };
}

// List Perfectly Date values look like 2024-11-02 13:04:00. Those are not SKUs.
export function inferredSku(item) {
  if (has(item?.sku)) return String(item.sku).trim();
  if (String(item?.source ?? '') !== 'listperfectly') return null;
  const sid = String(item?.source_id ?? '').trim();
  if (!sid) return null;
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(sid)) return null;
  const dated = sid.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\s+(\S+)/);
  if (dated) return acceptToken(dated[1]) ? dated[1] : null;
  if (/^[a-f0-9]{40}$/i.test(sid)) return null;
  const first = sid.split(/\s+/)[0];
  return acceptToken(first) ? first : null;
}

export function compactStyleSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  return {
    status: sample.status ?? 'none',
    matches: arr(sample.matches).map(m => ({
      maker_name: m?.maker_name ?? null,
      style_number: m?.style_number ?? null,
      record_title: m?.record_title,
      record_url: m?.record_url,
      other_card_text: m?.other_card_text ?? null,
    })),
    maker: sample.maker ?? null,
    styles: arr(sample.styles),
    note: sample.note,
  };
}

export function compactMakerDirectory(makers) {
  return arr(makers).map(m => (typeof m === 'string' ? { name: m } : { name: m?.name })).filter(m => has(m.name));
}

// Adds catalog snapshots that asmoWBW needs for exact maker / maker+style matches.
// Callers pass already-loaded snapshots so this file stays free of filesystem imports.
export function withCatalog(input, opt = {}) {
  const out = { ...input };
  if (opt.makers && out.maker_directory == null) out.maker_directory = compactMakerDirectory(opt.makers);
  const existing = out.style_sample;
  if (opt.styleSample && (existing == null || (existing.status === 'none' && !arr(existing.matches).length))) {
    out.style_sample = compactStyleSample(opt.styleSample);
  } else if (existing) {
    out.style_sample = compactStyleSample(existing);
  }
  return out;
}

// Builds the contract JSON from an items row, a sellers row, and optional photo-byte sidecars.
export function listingInput(item, seller, media) {
  const it = item ?? {};
  const input = {
    id: it.id ?? null,
    seller: text(it.seller),
    source: has(it.source) ? String(it.source) : null,
    source_id: has(it.source_id) ? String(it.source_id) : null,
    source_url: has(it.source_url) ? String(it.source_url) : null,
    status: it.status ?? null,
    boot: it.boot ?? null,
    boot_score: it.boot_score ?? null,
    photos: arr(it.photos).map(String),
    src_photos: has(it.src_photos) ? String(it.src_photos) : null,
    title: it.title ?? null,
    description: it.description ?? null,
    id_text: has(it.id_text) ? String(it.id_text) : null,
    price: it.price ?? null,
    wbw_price: it.wbw_price ?? null,
    brand: has(it.brand) ? String(it.brand) : null,
    sized_for: has(it.sized_for) ? String(it.sized_for) : null,
    size: has(it.size) ? String(it.size) : null,
    size_estimated: has(it.size_estimated) ? String(it.size_estimated) : null,
    width: has(it.width) ? String(it.width) : null,
    material_type: has(it.material_type) ? String(it.material_type) : null,
    material: has(it.material) ? String(it.material) : null,
    material_cut: has(it.material_cut) ? String(it.material_cut) : null,
    made_in: has(it.made_in) ? String(it.made_in) : null,
    condition: has(it.condition) ? String(it.condition) : null,
    color: has(it.color) ? String(it.color) : null,
    keywords: has(it.keywords) ? String(it.keywords) : null,
    sole_length: has(it.sole_length) ? String(it.sole_length) : null,
    sole_width: has(it.sole_width) ? String(it.sole_width) : null,
    heel_height: has(it.heel_height) ? String(it.heel_height) : null,
    shaft_circ: has(it.shaft_circ) ? String(it.shaft_circ) : null,
    shaft_height: has(it.shaft_height) ? String(it.shaft_height) : null,
    sole: has(it.sole) ? String(it.sole) : null,
    heel: has(it.heel) ? String(it.heel) : null,
    toe: has(it.toe) ? String(it.toe) : null,
    guessed: arr(it.guessed).map(String),
    verified: arr(it.verified).map(String),
    opt_error: has(it.opt_error) ? String(it.opt_error) : null,
    opt_original: jsonField(it.opt_original),
    opt_proposal: jsonField(it.opt_proposal),
    opt_applied: jsonField(it.opt_applied),
    seller_profile: publicSeller(seller ?? { name: it.seller }),
    markets: has(it.markets) ? String(it.markets) : null,
    source_condition: has(it.source_condition) ? String(it.source_condition) : null,
    missing_group_price: !!it.missing_group_price,
    style_ref: jsonField(it.style_ref),
    style_sample: compactStyleSample(jsonField(it.opt_proposal)?.style_sample ?? jsonField(it.style_sample) ?? null),
    boot_references: arr(it.boot_references),
    id_photos: jsonField(it.id_photos),
    id_checked_at: it.id_checked_at ?? null,
    seller_notes: has(it.seller_notes) ? String(it.seller_notes) : null,
    sku: has(it.sku) ? String(it.sku) : inferredSku(it),
  };
  if (it.maker_directory) input.maker_directory = compactMakerDirectory(it.maker_directory);
  if (media) input.media = media;
  return input;
}
