// Deterministic listing copy from fields the seller already has. No network, no synonym list, no image bytes.
import { factsFingerprint, listingFacts, possessive } from './facts';
import { matchReferences } from './references';
import { altText, fileName } from './seo';
import { matchStyleSample } from './style-sample';
import { suggestMaker } from './wbw-ref';

const ORDERS = [
  ['head', 'size', 'skin', 'shape', 'condition', 'origin', 'meas', 'model'],
  ['size', 'skin', 'head', 'origin', 'meas', 'shape', 'condition', 'model'],
  ['skin', 'head', 'shape', 'size', 'meas', 'origin', 'condition', 'model'],
];
const NOTE = ['From the seller:', "Seller's listing:", 'As imported:'];

export function structureVariant(seed) {
  let h = 2166136261;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 3;
}

export function cleanText(s) {
  return String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?[a-z][^>\n]*>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n).trim());

function snapshot(item, now) {
  return importOriginal(item, item.photos, now);
}

// Captured from a source payload and the stored photo URLs. `first` is the earliest import; the top level is the current source.
export function importOriginal(raw, photos, now) {
  return {
    title: String(raw?.title ?? ''), description: String(raw?.description ?? ''), price: raw?.price ?? null,
    brand: raw?.brand ?? null, size: raw?.size ?? null, width: raw?.width ?? null, material: raw?.material ?? null,
    photos: [...(photos ?? [])], captured_at: now ?? null,
  };
}

function withoutFirst(snap) {
  if (!snap) return null;
  const { first: _first, ...rest } = snap;
  return rest;
}

// Same src_hash → no write. A real source change refreshes the current snapshot, keeps the first import, and drops drafts.
export function sourceRefreshPlan(old, srcHash, snapshot) {
  const hash = String(srcHash ?? '');
  if (old?.src_hash && old.src_hash === hash) return null;
  const prev = jsonField(old?.opt_original);
  const current = withoutFirst(snapshot) ?? {};
  current.src_hash = hash;
  const first = prev?.first ? withoutFirst(prev.first) : (prev ? withoutFirst(prev) : { ...current });
  const changed = !!(old?.src_hash && old.src_hash !== hash);
  return {
    opt_original: { ...current, first },
    opt_proposal: changed ? null : undefined,
    opt_applied: changed ? null : undefined,
    style_ref: changed ? null : undefined,
    changed,
  };
}

function sentences(v) {
  const out = [];
  const head = [v.brand, v.noun].filter(Boolean).join(' ');
  if (head) out.push({ key: 'head', text: `${head}.` });
  const sizeBits = [v.sized_label, v.size && `size ${v.size}`, v.width && `${v.width} width`].filter(Boolean);
  if (sizeBits.length) out.push({ key: 'size', text: `${cap(sizeBits.join(', '))}.` });
  const skin = [v.color, v.material, v.material_cut && `${v.material_cut} cut`].filter(Boolean);
  if (skin.length) out.push({ key: 'skin', text: `${cap(skin.join(', '))}.` });
  const shape = [v.toe, v.heel, v.sole && `${v.sole} sole`].filter(Boolean);
  if (shape.length) out.push({ key: 'shape', text: `${cap(shape.join(', '))}.` });
  if (v.condition) out.push({ key: 'condition', text: `Condition: ${v.condition}.` });
  if (v.made_in) out.push({ key: 'origin', text: `Made in ${v.made_in}.` });
  const meas = [v.sole_length && `sole length ${v.sole_length} in`, v.sole_width && `sole width ${v.sole_width} in`,
    v.heel_height && `heel height ${v.heel_height} in`, v.shaft_circ && `shaft circumference ${v.shaft_circ} in`,
    v.shaft_height && `shaft height ${v.shaft_height} in`].filter(Boolean);
  if (meas.length) out.push({ key: 'meas', text: `${cap(meas.join(', '))}.` });
  if (v.model) out.push({ key: 'model', text: v.model });
  return out;
}

function orderSentences(list, variant) {
  const by = Object.fromEntries(list.map(s => [s.key, s.text]));
  return ORDERS[variant].map(k => by[k]).filter(Boolean);
}

function buildTitle(v, variant, fallback) {
  const size = v.size ? `size ${v.size}` : '';
  const width = v.width ? `${v.width} width` : '';
  const who = v.sized_for ? possessive(v.sized_for) : '';
  const rows = [
    [v.brand, who, v.color, v.material, v.noun, size, width],
    [v.color, v.material, v.brand, v.noun, size, width],
    [v.brand, size, width, v.color, v.material, v.noun],
  ];
  const title = rows[variant].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (title) return { title, title_from: 'generated' };
  return { title: cleanText(fallback).replace(/\s+/g, ' ').trim(), title_from: 'original' };
}

function compose(facts, notes, variant) {
  const note = notes ? `${NOTE[variant]}\n${notes}` : '';
  const body = facts.join(' ');
  if (!body) return note;
  if (!note) return body;
  return variant === 1 ? `${note}\n\n${body}` : `${body}\n\n${note}`;
}

function shortText(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= 160) return t;
  const cut = t.slice(0, 160);
  const sp = cut.lastIndexOf(' ');
  return (sp > 80 ? cut.slice(0, sp) : cut).trim();
}

export function copyNames(item) {
  const seen = new Set();
  return (item.photos ?? []).map((stored_url, i) => {
    const n = i + 1;
    let file = fileName(item, n);
    let k = 2;
    while (seen.has(file)) { file = file.replace(/\.jpg$/i, `-${k}.jpg`); k += 1; }
    seen.add(file);
    return { n, file, alt: altText(item, n), stored_url, source_renamed: false, pixels: 'unchanged' };
  });
}

// The model is already in the imported listing. The note's provenance stays off the public wording.
function modelSentence(m) {
  return `Model ${m.model}.`;
}

// Import-time optimization. Listing text stays on the item. Photo names, alt text, and SEO meta are stored for export.
export function autoOptimizeFields(item, refs = [], opt = {}) {
  try {
    const { original, proposal } = optimize(item, refs, opt);
    return {
      ok: true,
      opt_original: original,
      opt_proposal: proposal,
      opt_applied: {
        images: proposal.images,
        facts_fp: proposal.facts_fp,
        seo_title: proposal.portable?.seo_title ?? proposal.title,
        seo_description: proposal.portable?.seo_description ?? '',
        variant: proposal.variant,
        applied_at: opt.now ?? null,
        scope: 'images-seo',
      },
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Optimization failed.' };
  }
}

const CONTENT_FIELDS = ['title', 'price', 'wbw_price', 'brand', 'sized_for', 'size', 'size_estimated', 'width', 'material_type', 'material', 'material_cut', 'made_in', 'condition', 'color', 'keywords', 'sole_length', 'sole_width', 'heel_height', 'shaft_circ', 'shaft_height', 'sole', 'heel', 'toe', 'description', 'id_text'];

// Writes opt_* only. Restores any content field that was already chosen, including a museum price.
export function applyAutoOptimization(fields, item, ctx = {}) {
  const kept = {};
  for (const f of CONTENT_FIELDS) if (fields[f] !== undefined) kept[f] = fields[f];
  const out = autoOptimizeFields({ ...item, ...fields, photos: fields.photos ?? item.photos }, ctx.refs ?? [], ctx);
  if (!out.ok) {
    fields.opt_error = out.error;
    for (const f of CONTENT_FIELDS) if (f in kept) fields[f] = kept[f];
    return fields;
  }
  fields.opt_original = out.opt_original;
  fields.opt_proposal = out.opt_proposal;
  fields.opt_applied = out.opt_applied;
  fields.opt_error = null;
  for (const f of CONTENT_FIELDS) if (f in kept) fields[f] = kept[f];
  return fields;
}

export function optimize(item, refs = [], opt = {}) {
  const original = jsonField(item.opt_original) ?? snapshot(item, opt.now);
  const anchored = { ...item, opt_original: original };
  const { values, omitted, used } = listingFacts(anchored);
  const facts_fp = factsFingerprint(anchored);
  const suggestion = values.brand ? suggestMaker(values.brand, opt.directory) : null;
  const named = suggestion ? { ...values, brand: suggestion.name } : values;
  const matched = matchReferences({ ...anchored, title: original.title, description: original.description }, refs);
  const models = matched.matches.filter(m => m.use).map(modelSentence);
  const variant = structureVariant(item.source_id || item.id || original.title);
  const fact_sentences = orderSentences(sentences({ ...named, model: models.join(' ') }), variant);
  const seller_notes = cleanText(original.description);
  const { title, title_from } = buildTitle(named, variant, original.title);
  const description = compose(fact_sentences, seller_notes, variant);
  const seo_description = shortText(fact_sentences.join(' ') || seller_notes);
  const proposal = {
    title, description, title_from, variant, facts: fact_sentences.join(' '), fact_sentences, seller_notes,
    images: copyNames(anchored), omitted, used, matches: matched.matches, reference_note: matched.note,
    references_connected: false, facts_fp, width_exact: item.width ?? null,
    directory: {
      live: false, model_lookup: false, fetched_at: opt.fetched_at ?? null, sample_used: false,
      suggestion: suggestion ? { name: suggestion.name, section: suggestion.section, url: suggestion.url, source_url: suggestion.source_url, fetched_at: suggestion.fetched_at, applies_to_boot: false } : null,
    },
    style_sample: matchStyleSample(anchored, opt.styleSample, named.brand),
    width_note: 'Titles and descriptions keep the exact width. The sell-a-pair Width column shows A for AA, AAA, and AAAA. N stays N.',
    portable: {
      seo_title: title, seo_title_column: 'Listing title', seo_description, seo_description_exported: false, seo_description_column: null,
      image_alt_column: 'Image Alt Text',
      note: 'The short SEO description is not a sell-a-pair column. Product schema, canonical URLs, breadcrumbs, and sitemaps belong to the destination site. BootLister stays noindex.',
    },
  };
  return { original, proposal };
}

export function editProposal(proposal, patch) {
  const title = patch.title !== undefined ? clip(cleanText(patch.title), 180) : proposal.title;
  const description = patch.description !== undefined ? clip(cleanText(patch.description), 5000) : proposal.description;
  return { ...proposal, title, description, edited: true, portable: { ...(proposal.portable ?? {}), seo_title: title } };
}

// Returns the columns to write. Photos are not included, so stored files stay put.
export function assertFresh(item, proposal) {
  const original = jsonField(item?.opt_original);
  const anchored = original ? item : { ...item, opt_original: original };
  if (!proposal?.facts_fp || proposal.facts_fp !== factsFingerprint(original ? item : anchored))
    throw new Error('This draft is out of date. Prepare it again.');
}

export function applyOptimization(item, prepared, opt = {}) {
  const proposal = prepared?.proposal ?? prepared;
  const original = prepared?.original ?? jsonField(item.opt_original) ?? snapshot(item, opt.now);
  assertFresh({ ...item, opt_original: jsonField(item.opt_original) ?? original }, proposal);
  const next = opt.title !== undefined || opt.description !== undefined ? editProposal(proposal, opt) : proposal;
  return {
    title: next.title, description: next.description, opt_original: original, opt_proposal: next,
    opt_applied: {
      title: next.title, description: next.description, images: next.images, facts_fp: next.facts_fp,
      seo_title: next.portable?.seo_title ?? next.title, seo_description: next.portable?.seo_description ?? '',
      variant: next.variant, applied_at: opt.now ?? null,
    },
  };
}
