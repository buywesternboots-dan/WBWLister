// Deterministic listing copy from fields the seller already has. No network, no synonym list, no image bytes.
import { matchReferences } from './references';

const ORDERS = [
  ['head', 'size', 'skin', 'shape', 'condition', 'origin', 'meas', 'model'],
  ['size', 'skin', 'head', 'origin', 'meas', 'shape', 'condition', 'model'],
  ['skin', 'head', 'shape', 'size', 'meas', 'origin', 'condition', 'model'],
];
const NOTE = ['From the seller:', "Seller's listing:", 'As imported:'];
const GENDER = /\b(men|women|kids|man|woman|ladies|youth)\b/i;

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
    .replace(/<[^>]*>/g, ' ')
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
const has = v => v != null && String(v).trim() !== '';
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n).trim());

function snapshot(item, now) {
  return {
    title: item.title ?? '', description: item.description ?? '', price: item.price ?? null, brand: item.brand ?? null,
    size: item.size ?? null, width: item.width ?? null, material: item.material ?? null, photos: [...(item.photos ?? [])],
    captured_at: now ?? null,
  };
}

function usable(item, field) {
  if (!has(item[field])) return false;
  const guessed = (item.guessed ?? []).includes(field);
  const verified = (item.verified ?? []).includes(field);
  return !guessed || verified;
}

function assess(item) {
  const original = jsonField(item.opt_original);
  const text = `${original?.title ?? item.title ?? ''}\n${original?.description ?? item.description ?? ''}`;
  const verified = new Set(item.verified ?? []);
  const omitted = [], used = [];
  const take = (field, ok = usable(item, field)) => {
    if (ok && has(item[field])) { used.push(field); return item[field]; }
    if (has(item[field]) || (item.guessed ?? []).includes(field)) {
      const inferred = (item.guessed ?? []).includes(field) && !verified.has(field);
      omitted.push({ field, reason: inferred
        ? 'Inferred from the listing and not verified, so it is left out of the new wording.'
        : 'Left out of the new wording because the listing does not state it.' });
    }
    return null;
  };
  const gender = take('sized_for', usable(item, 'sized_for') && (verified.has('sized_for') || GENDER.test(text)));
  const conditionOk = usable(item, 'condition') && (verified.has('condition') || (
    item.condition === 'New' ? /\b(brand new|deadstock|never worn|nwt|new with tags)\b/i.test(text)
      : item.condition === 'Custom Made' ? /\bcustom[- ]made|\bmade to order\b/i.test(text)
        : item.condition === 'Broken In' ? /\b(broken in|worn|used|pre-?owned)\b/i.test(text) : false));
  const values = {
    brand: take('brand'), sized_for: gender, sized_label: gender ? `listed for ${String(gender).toLowerCase()}` : '',
    size: take('size'), width: take('width'), color: take('color'), material: take('material'), material_cut: take('material_cut'),
    toe: take('toe'), heel: take('heel'), sole: take('sole'), condition: take('condition', conditionOk), made_in: take('made_in'),
    sole_length: take('sole_length'), sole_width: take('sole_width'), heel_height: take('heel_height'),
    shaft_circ: take('shaft_circ'), shaft_height: take('shaft_height'),
    noun: item.boot === 'belt' ? 'belt' : item.boot === 'boot' ? 'cowboy boots' : '',
  };
  return { values, omitted, used, text, original };
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
  const who = v.sized_for ? `${v.sized_for}'s` : '';
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

function namingView(item, used) {
  const view = { ...item };
  for (const f of ['brand', 'sized_for', 'size', 'width', 'color', 'material']) if (!used.has(f)) view[f] = null;
  if (item.boot !== 'boot' && item.boot !== 'belt') view.boot = null;
  return view;
}

export function copyNames(item) {
  const { used } = assess(item);
  const view = namingView(item, new Set(used));
  const noun = view.boot === 'belt' ? 'belt' : view.boot === 'boot' ? 'cowboy boots' : '';
  const bits = [view.brand, view.sized_for && `${view.sized_for}'s`, view.color, view.material, noun, view.size && `size ${view.size}`, view.width && `${view.width} width`].filter(Boolean);
  const slug = bits.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const id = String(item.id ?? 'item').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'item';
  const seen = new Set();
  return (item.photos ?? []).map((stored_url, i) => {
    const n = i + 1;
    let file = `${slug ? `${slug}-` : ''}${n}-${id}.jpg`;
    let k = 2;
    while (seen.has(file)) { file = `${slug ? `${slug}-` : ''}${n}-${id}-${k}.jpg`; k += 1; }
    seen.add(file);
    const alt = (bits.join(' ') || 'listing photo') + (n > 1 ? ` - view ${n}` : '');
    return { n, file, alt, stored_url, source_renamed: false, pixels: 'unchanged' };
  });
}

function modelSentence(m) {
  return `Model ${m.model} is already written in the listing. The confirmed note records its source as ${cleanText(m.provenance)}.`;
}

export function optimize(item, refs = [], opt = {}) {
  const original = jsonField(item.opt_original) ?? snapshot(item, opt.now);
  const anchored = { ...item, opt_original: original };
  const { values, omitted, used } = assess(anchored);
  const matched = matchReferences({ ...anchored, title: original.title, description: original.description }, refs);
  const models = matched.matches.filter(m => m.use).map(modelSentence);
  const variant = structureVariant(item.source_id || item.id || original.title);
  const fact_sentences = orderSentences(sentences({ ...values, model: models.join(' ') }), variant);
  const seller_notes = cleanText(original.description);
  const { title, title_from } = buildTitle(values, variant, original.title);
  const description = compose(fact_sentences, seller_notes, variant);
  const seo_description = shortText(fact_sentences.join(' ') || seller_notes);
  const proposal = {
    title, description, title_from, variant, facts: fact_sentences.join(' '), fact_sentences, seller_notes,
    images: copyNames(anchored), omitted, used, matches: matched.matches, reference_note: matched.note,
    references_connected: false, width_exact: item.width ?? null,
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
export function applyOptimization(item, prepared, opt = {}) {
  const proposal = prepared?.proposal ?? prepared;
  const next = opt.title !== undefined || opt.description !== undefined ? editProposal(proposal, opt) : proposal;
  const original = prepared?.original ?? jsonField(item.opt_original) ?? snapshot(item, opt.now);
  return {
    title: next.title, description: next.description, opt_original: original, opt_proposal: next,
    opt_applied: {
      title: next.title, description: next.description, images: next.images,
      seo_title: next.portable?.seo_title ?? next.title, seo_description: next.portable?.seo_description ?? '',
      variant: next.variant, applied_at: opt.now ?? null,
    },
  };
}
