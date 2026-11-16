// ASMOwbw: admin-only, on-command photo and media SEO for WBW and anywhere a listing is shared from WBW.
// Reads the input contract in docs/asmowbw-input-contract.md. Listing title, description, price, and size are never written.
import { factsFingerprint, listingFacts } from './facts';
import { acceptToken, imageValues, listingModel, seoBlurb } from './model';
import { altText, fileName, seoTitle } from './seo';
import { MATERIALS } from './vocab';

export const ASMO_LABEL = 'ASMOwbw';
export const MAX_EDGE = 2048;
export const JPEG_QUALITY = 82;
export const WEBP_QUALITY = 80;
export const CONTENT_FIELDS = ['title', 'description', 'price', 'wbw_price', 'size', 'size_estimated'];

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

const has = v => v != null && String(v).trim() !== '';
const text = v => (v == null ? null : String(v));
const arr = v => (Array.isArray(v) ? v : []);

// Local copies so this module stays browser-safe (wbw-ref and exact-fields import node:fs).
const makerKey = name => String(name ?? '').normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function exactMaker(brand, makers) {
  const raw = String(brand ?? '').trim();
  if (!raw || !makers?.length) return null;
  const hits = makers.filter(m => makerKey(m.name) === makerKey(raw));
  return hits.length === 1 ? hits[0] : null;
}

function exactMaterialName(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  const hits = MATERIALS.filter(m => m.name.toLowerCase() === s || m.aliases.some(a => a.toLowerCase() === s));
  return hits.length === 1 ? hits[0].name : '';
}


function publicSeller(seller) {
  const s = seller && typeof seller === 'object' ? seller : { name: seller };
  return {
    name: text(s.name ?? s.seller) || '',
    display_name: has(s.display_name) ? String(s.display_name).trim() : null,
    location: has(s.location) ? String(s.location).trim() : null,
    website: has(s.website) ? String(s.website).trim() : null,
    brand_context: has(s.brand_context) ? String(s.brand_context).trim() : null,
  };
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
    style_sample: jsonField(it.opt_proposal)?.style_sample ?? jsonField(it.style_sample) ?? null,
    boot_references: arr(it.boot_references),
    id_photos: jsonField(it.id_photos),
    id_checked_at: it.id_checked_at ?? null,
    seller_notes: has(it.seller_notes) ? String(it.seller_notes) : null,
    sku: has(it.sku) ? String(it.sku) : inferredSku(it),
  };
  if (media) input.media = media;
  return input;
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

// Exact style only: accepted catalog card, a single candidate match, labeled listing text, or verified id_text / stamp text / SKU.
export function chosenStyle(input) {
  const ref = input?.style_ref;
  const fromRef = String(ref?.style_number ?? '').trim();
  if (fromRef) return fromRef;
  const sample = input?.style_sample;
  if (sample?.status === 'candidate' && sample.matches?.length === 1) {
    const n = String(sample.matches[0].style_number ?? '').trim();
    if (n) return n;
  }
  const item = namingSource(input);
  const labeled = listingModel(item);
  if (labeled) return labeled;
  if ((input?.verified ?? []).includes('id_text') && acceptToken(String(input.id_text ?? '').trim().split(/\s+/)[0])) {
    const s = String(input.id_text).trim();
    if (s && s.length <= 40) return s;
  }
  const stamps = arr(input?.id_photos).map(p => String(p?.text ?? '').trim()).filter(t => acceptToken(t));
  if (stamps.length === 1) return stamps[0];
  const sku = String(input?.sku ?? '').trim();
  if (sku && acceptToken(sku)) return sku;
  return '';
}

export function chosenBrand(input, directory) {
  const raw = input?.brand || '';
  const maker = exactMaker(raw, directory);
  return maker?.name || raw || '';
}

export function namingSource(input) {
  const verified = new Set(input?.verified ?? []);
  const style = String(input?.style_ref?.style_number ?? '').trim();
  if (style) verified.add('id_text');
  const refs = arr(input?.boot_references);
  const confirmed = refs.find(r => r.status === 'confirmed' && r.model && (
    new RegExp(`\\b${String(r.model).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${input?.title ?? ''}\n${input?.description ?? ''}`)
    || verified.has('id_text')
  ));
  return {
    id: input.id,
    seller: input.seller_profile?.display_name || input.seller,
    source_id: input.source_id,
    title: input.title,
    description: input.description,
    brand: input.brand,
    sized_for: input.sized_for,
    size: input.size,
    width: input.width,
    color: input.color,
    material: input.material,
    material_cut: input.material_cut,
    material_type: input.material_type,
    made_in: input.made_in,
    condition: input.condition,
    sole: input.sole,
    heel: input.heel,
    toe: input.toe,
    sole_length: input.sole_length,
    sole_width: input.sole_width,
    heel_height: input.heel_height,
    shaft_circ: input.shaft_circ,
    shaft_height: input.shaft_height,
    keywords: input.keywords,
    boot: input.boot,
    photos: input.photos,
    guessed: input.guessed,
    verified: [...verified],
    id_text: style || input.id_text,
    opt_original: input.opt_original,
  };
}

function variant(seed) {
  let h = 2166136261;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 3;
}

function varyAlt(base, n, total, seed) {
  const v = variant(`${seed}:${n}`);
  if (total <= 1) return v === 2 ? `${base} — listing photo` : base;
  if (v === 1) return `Photo ${n} of ${total}: ${base}`;
  if (v === 2) return `${base} (image ${n} of ${total})`;
  return `${base} - photo ${n} of ${total}`;
}

function captionFor(base, n, total, seed, meas) {
  const v = variant(`${seed}:cap:${n}`);
  const extra = meas ? ` ${meas}` : '';
  if (v === 1) return `${base}${extra}`.trim();
  if (v === 2) return total > 1 ? `${base}, view ${n} of ${total}${extra}`.trim() : `${base}${extra}`.trim();
  return total > 1 ? `${base} — photo ${n} of ${total}${extra}`.trim() : `${base}${extra}`.trim();
}

function measurePhrase(item) {
  const bits = [
    item.sole_length && `sole length ${item.sole_length} in`,
    item.sole_width && `sole width ${item.sole_width} in`,
    item.heel_height && `heel height ${item.heel_height} in`,
    item.shaft_circ && `shaft circumference ${item.shaft_circ} in`,
    item.shaft_height && `shaft height ${item.shaft_height} in`,
  ].filter(Boolean);
  return bits.length ? bits.join(', ') : '';
}

function applyExactMaterial(item, input) {
  const card = input?.style_ref?.other_card_text || (input?.style_sample?.status === 'candidate' && input.style_sample.matches?.length === 1
    ? input.style_sample.matches[0].other_card_text : '');
  const mat = exactMaterialName(card);
  if (!mat) return item;
  const cur = String(item.material ?? '').trim();
  const curExact = exactMaterialName(cur);
  if (cur && curExact && curExact !== mat) return item;
  if (cur && (item.verified ?? []).includes('material') && curExact !== mat) return item;
  return { ...item, material: mat };
}

// Pure naming pass. Does not touch pixels or listing text.
export function planMedia(input, opt = {}) {
  const style = chosenStyle(input);
  const brand = chosenBrand(input, opt.directory);
  let item = namingSource({ ...input, brand: brand || input.brand, style_ref: style ? { ...(input.style_ref ?? {}), style_number: style } : input.style_ref });
  if (brand) item = { ...item, brand };
  item = applyExactMaterial(item, input);
  if (style) item = { ...item, id_text: style, verified: [...new Set([...(item.verified ?? []), 'id_text'])] };
  const total = (item.photos ?? []).length;
  const facts_fp = factsFingerprint(namingSource({
    ...input,
    style_ref: style ? { ...(input.style_ref ?? {}), style_number: style } : input.style_ref,
  }));
  const values = imageValues(item);
  const seo_title = seoTitle(item, values);
  const seo_description = seoBlurb(item, values);
  const { used, omitted } = listingFacts(item);
  const meas = measurePhrase(item);
  const seed = `${item.id || input.source_id || seo_title}`;
  const seen = new Set();
  const images = (item.photos ?? []).map((stored_url, i) => {
    const n = i + 1;
    let file = fileName(item, n);
    let k = 2;
    while (seen.has(file)) { file = file.replace(/\.jpg$/i, `-${k}.jpg`); k += 1; }
    seen.add(file);
    const base = altText(item, 1, 1);
    const alt = varyAlt(base, n, total, seed);
    const caption = captionFor(base, n, total, seed, meas);
    const stem = file.replace(/\.jpg$/i, '');
    return {
      n, file, webp_file: `${stem}.webp`, alt, caption, title: caption,
      stored_url, jpeg_url: null, webp_url: null,
      width: null, height: null, pixels: 'pending',
      og: {
        title: seo_title || caption,
        description: seo_description,
        image: `/img/${input.id}/${n}/${file}`,
        alt, width: null, height: null,
      },
      source_renamed: false,
    };
  });
  return {
    facts_fp, seo_title, seo_description, images, used, omitted,
    style: style || null, brand: brand || null,
    credit: `${item.seller || input.seller} via westernbootworld.com`,
  };
}

export function withPrevious(current, previous) {
  if (!previous) return current;
  const { previous: _drop, ...kept } = previous;
  return { ...current, previous: kept };
}

export function undoRecord(current) {
  if (!current) return { asmowbw: null, undone: false };
  if (current.previous) return { asmowbw: current.previous, undone: true };
  return { asmowbw: null, undone: true };
}

// Prefer a fresh ASMOwbw pass when the photos and facts still match the run that was stored.
export function appliedAsmo(item, opt = {}) {
  const applied = jsonField(item?.asmowbw);
  const photos = item?.photos ?? [];
  if (applied?.media !== 'asmowbw') return null;
  if (!applied.images?.length || applied.images.length !== photos.length) return null;
  for (let i = 0; i < photos.length; i++) {
    if (applied.images[i]?.stored_url !== photos[i] || applied.images[i].n !== i + 1) return null;
  }
  const plan = planMedia(listingInput(item, opt.seller ?? { name: item.seller }), opt);
  if (!applied.facts_fp || applied.facts_fp !== plan.facts_fp) return null;
  return applied;
}

export function asmoSummaryLine(result) {
  const s = result?.summary ?? result ?? {};
  const bits = [`${s.photos ?? 0} photo(s) named`];
  if (s.optimized) bits.push(`${s.optimized} optimized`);
  if (s.unchanged) bits.push(`${s.unchanged} kept original pixels`);
  if (s.failed) bits.push(`${s.failed} failed`);
  if (s.style) bits.push(`style ${s.style}`);
  return bits.join(', ');
}
