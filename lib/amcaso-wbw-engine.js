// amcasoWBW naming and copy in JavaScript: a port of amcaso_wbw facts.py, copy.py, and run.py (v0.3.2, WBW path).
// Runs inside BootLister so one click needs no Python, no worker, and no PC. Golden tests compare it with the Python tool.
// Not ported: pixel view analysis (side/front/sole words). Photos are named "-N" and "photo N of M", as the Python tool
// does for any photo it cannot classify with confidence.
import { prepareWbwImage, extFor } from './amcaso-wbw-media';

export const ENGINE_VERSION = '0.3.2';
export const ENGINE = 'bootlister-js';

const GENDER_RE = /\b(men(?:'?s)?|mens|women(?:'?s)?|womens|kids|man|woman|ladies|youth)\b/i;
const LABEL_RE = /\b(model|style|lot|sku)(?:\s+(?:number|no\.?))?\s*[#:]\s*([A-Za-z0-9][A-Za-z0-9-]*)|\b(model|style|lot|sku)\s+(?:number|no\.?)\s+([A-Za-z0-9][A-Za-z0-9-]*)/gi;
const SIZE_TOKEN = /^(?:\d{1,2}(?:\.5)?)(?:-?[a-e]{1,4})?$/i;
const COMPOUND_COLOR = /^(black cherry|chocolate brown)$/i;
const COLOR_WORD = /^(black|brown|tan|cognac|chocolate|honey|red|bone|white|grey|gray|blue|green|burgundy|oxblood|natural|camel|saddle|rust|cherry)$/i;
const MATERIALS = [
  ['Caiman Lizard', ['caiman lizard', 'hornback lizard', 'hbl']], ['Caiman Belly', ['caiman belly']],
  ['Hornback Caiman', ['hornback caiman', 'caiman hornback']], ['Caiman', ['caiman']],
  ['Full Quill Ostrich', ['full quill ostrich', 'full-quill ostrich', 'fq ostrich', 'full quill']], ['Smooth Ostrich', ['smooth ostrich']],
  ['Ostrich Leg', ['ostrich leg']], ['Ostrich', ['ostrich']], ['Alligator', ['alligator', 'gator']], ['Crocodile', ['crocodile', 'croc']],
  ['Teju Lizard', ['teju lizard', 'tegu lizard', 'teju', 'tegu']], ['Ring Lizard', ['ring lizard']], ['Lizard', ['lizard']],
  ['Python', ['python']], ['Snake', ['rattlesnake', 'sea snake', 'snake']], ['Eel', ['eel']], ['Stingray', ['stingray', 'shagreen']],
  ['Shark', ['shark']], ['Hippo', ['hippopotamus', 'hippo']], ['Elephant', ['elephant']], ['Sea Turtle', ['sea turtle', 'turtle']],
  ['Anteater', ['anteater']], ['Bullfrog', ['bullfrog', 'frog']], ['Toad', ['toad']], ['Bison', ['bison', 'buffalo']],
  ['Kangaroo', ['kangaroo']], ['Peccary', ['peccary']], ['Goat', ['goat']], ['Calf', ['calfskin', 'calf']], ['Cowhide', ['cowhide']],
  ['Suede', ['suede']], ['Roughout', ['roughout', 'rough out']], ['Leather', ['leather']],
];

const has = v => v != null && String(v).trim() !== '';
const str = v => (v == null || v === false ? '' : String(v));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const arr = v => (Array.isArray(v) ? v : []);
const obj = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; } }
  return typeof v === 'object' && !Array.isArray(v) ? v : null;
};
const uniq = list => [...new Set(list)];
const makerKey = n => str(n).normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const normStyle = v => str(v).normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function sourceText(item) {
  const o = obj(item.opt_original) || {};
  return [item.title, item.description, o.title, o.description].filter(p => p != null && p !== '').map(String).join('\n');
}
const mentions = (text, value) => { const s = str(value).trim(); return !!s && new RegExp(`\\b${reEsc(s)}\\b`, 'i').test(text); };
const mentionedSize = (text, size) => { const s = str(size).trim(); return !!s && new RegExp(`\\b(?:size\\s*:?\\s*)?${reEsc(s)}(?:\\s*-?\\s*[a-e]{1,4})?\\b`, 'i').test(text); };
function mentionedWidth(text, size, width) {
  const w = str(width).trim();
  if (!w) return false;
  const s = str(size).trim();
  if (s && new RegExp(`\\b${reEsc(s)}\\s*-?\\s*${reEsc(w)}\\b`, 'i').test(text)) return true;
  return new RegExp(`\\bwidth\\s*:?\\s*${reEsc(w)}\\b`, 'i').test(text);
}

function acceptToken(token) {
  const t = str(token).trim();
  if (!t || t.length > 20) return false;
  if (SIZE_TOKEN.test(t) || /^[a-e]{1,4}$/i.test(t)) return false;
  if (t.startsWith('$') || /^\d+\.\d{2}$/.test(t)) return false;
  const digits = t.replace(/\D/g, '');
  return digits.length >= 3 && !/^0+$/.test(digits);
}
function extractModel(text) {
  for (const m of str(text).matchAll(LABEL_RE)) {
    const label = (m[1] || m[3] || '').toLowerCase(), token = m[2] || m[4] || '';
    if (label === 'sku' && /^sku#[a-z0-9]/i.test(m[0].trim())) continue;
    if (acceptToken(token)) return token;
  }
  return '';
}
function styleField(value) {
  const s = str(value).trim();
  if (!s || s.length > 40) return '';
  const parts = s.split(/\s+/);
  if (parts.length > 3 || !parts.every(p => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(p) && acceptToken(p))) return '';
  return s;
}
export function listingModel(item) {
  const o = obj(item.opt_original) || {};
  for (const text of [`${item.title || ''}\n${item.description || ''}`, `${o.title || ''}\n${o.description || ''}`]) {
    const found = extractModel(text);
    if (found) return found;
  }
  return arr(item.verified).includes('id_text') ? styleField(item.id_text) : '';
}
export function colorPhrase(color) {
  const parts = [];
  for (const part of str(color).split(/\s*(?:,|\/|&|\band\b)\s*/i)) {
    const bit = part.trim();
    if (!bit) continue;
    if (COMPOUND_COLOR.test(bit)) { parts.push(bit.replace(/\b\w/g, c => c.toUpperCase())); continue; }
    const words = bit.split(/\s+/);
    if (words.length > 1 && words.every(w => COLOR_WORD.test(w))) parts.push(...words.map(w => w[0].toUpperCase() + w.slice(1)));
    else parts.push(bit);
  }
  return parts.join(', ');
}
function exactMaterial(text) {
  const s = str(text).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  const hits = MATERIALS.filter(([name, aliases]) => name.toLowerCase() === s || aliases.includes(s)).map(([n]) => n);
  return hits.length === 1 ? hits[0] : '';
}
function exactMaker(brand, makers) {
  const key = makerKey(brand);
  if (!key || !makers?.length) return null;
  const hits = makers.filter(m => makerKey(m?.name) === key);
  return hits.length === 1 ? hits[0] : null;
}
const drop = (list, f) => arr(list).filter(g => g !== f);

function applyStyleAndMaker(input) {
  let item = { ...input };
  const flags = { brand_exact: false, style_status: 'blank', material_status: 'none' };
  const verified = new Set(arr(item.verified));
  const maker = exactMaker(item.brand, arr(item.maker_directory));
  if (maker && (!verified.has('brand') || makerKey(item.brand) === makerKey(maker.name))) {
    item = { ...item, brand: maker.name, guessed: drop(item.guessed, 'brand') };
    flags.brand_exact = true;
  }
  const sample = obj(item.style_sample) || {};
  const matches = arr(sample.matches);
  if (sample.status === 'ambiguous') flags.style_status = 'ambiguous';
  else if (sample.status === 'candidate' && matches.length === 1) {
    flags.style_status = 'matched';
    const match = matches[0] || {}, style = match.style_number, current = str(item.id_text).trim();
    if (style && (!current || !verified.has('id_text') || normStyle(current) === normStyle(style)))
      item = { ...item, id_text: String(style), guessed: drop(item.guessed, 'id_text'), verified: uniq([...arr(item.verified), 'id_text']) };
    const mat = exactMaterial(match.other_card_text), curMat = str(item.material).trim(), curExact = exactMaterial(curMat);
    if (mat && curExact && curExact !== mat) flags.material_status = 'needs-human';
    else if (mat && (!curMat || !verified.has('material') || curExact === mat)) {
      item = { ...item, material: mat, guessed: drop(item.guessed, 'material') };
      flags.material_status = 'applied';
    } else if (match.other_card_text && !curExact) flags.material_status = 'needs-human';
  } else if (Array.isArray(sample.styles) ? sample.styles.length : sample.styles) flags.style_status = 'none';
  const ref = obj(item.style_ref);
  if (ref?.style_number && flags.style_status !== 'ambiguous') {
    const style = String(ref.style_number), current = str(item.id_text).trim();
    if (!current || !verified.has('id_text') || normStyle(current) === normStyle(style)) {
      item = { ...item, id_text: style, verified: uniq([...arr(item.verified), 'id_text']) };
      if (flags.style_status === 'blank') flags.style_status = 'matched';
    }
  }
  const text = sourceText(item), modelNow = listingModel(item) || str(item.id_text);
  for (const r of arr(item.boot_references)) {
    if (!r || typeof r !== 'object' || str(r.status).toLowerCase() !== 'confirmed') continue;
    const model = str(r.model).trim();
    if (model && (mentions(text, model) || normStyle(model) === normStyle(modelNow)) && !item.id_text) item = { ...item, id_text: model };
  }
  return { item, flags };
}

const usableStored = (item, f) => has(item[f]) && (!arr(item.guessed).includes(f) || arr(item.verified).includes(f));
function conditionOk(item, text) {
  if (!usableStored(item, 'condition')) return false;
  if (arr(item.verified).includes('condition')) return true;
  const c = str(item.condition);
  if (c === 'New') return /\b(brand new|deadstock|never worn|nwt|new with tags)\b/i.test(text);
  if (c === 'Custom Made') return /\bcustom[- ]made|\bmade to order\b/i.test(text);
  if (c === 'Broken In') return /\b(broken in|worn|used|pre-?owned)\b/i.test(text);
  return mentions(text, c);
}

export function listingFacts(input) {
  const { item, flags } = applyStyleAndMaker(input);
  const text = sourceText(item), verified = new Set(arr(item.verified)), guessed = arr(item.guessed);
  const omitted = [], used = [];
  const take = (f, ok) => {
    if (ok === undefined) ok = usableStored(item, f) || (has(item[f]) && guessed.includes(f)
      && (mentions(text, item[f]) || (f === 'size' && mentionedSize(text, item.size)) || (f === 'width' && mentionedWidth(text, item.size, item.width))));
    if (ok && has(item[f])) { used.push(f); return item[f]; }
    if (has(item[f]) || guessed.includes(f)) omitted.push({ field: f, reason: guessed.includes(f) && !verified.has(f)
      ? 'Inferred from the listing and not verified, so it is left out of the new wording.'
      : 'Left out of the new wording because the listing does not state it.' });
    return null;
  };
  const stated = GENDER_RE.test(text);
  const gender = take('sized_for', !!(has(item.sized_for) && (verified.has('sized_for') || stated) && (usableStored(item, 'sized_for') || stated)));
  const boot = str(item.boot);
  const values = {
    brand: take('brand'), sized_for: gender, sized_label: gender ? `listed for ${String(gender).toLowerCase()}` : '',
    size: take('size'), width: take('width'), color: take('color'), material: take('material'), material_cut: take('material_cut'),
    material_type: take('material_type'), toe: take('toe'), heel: take('heel'), sole: take('sole'),
    condition: take('condition', conditionOk(item, text)), made_in: take('made_in'), sole_length: take('sole_length'),
    sole_width: take('sole_width'), heel_height: take('heel_height'), shaft_circ: take('shaft_circ'), shaft_height: take('shaft_height'),
    noun: boot === 'belt' ? 'belt' : boot === 'boot' ? 'cowboy boots' : '', keywords: take('keywords'),
  };
  const keep = f => {
    const current = values[f];
    if (has(current)) return current;
    const raw = item[f];
    if (f === 'size' && mentionedSize(text, raw)) { used.push(f); return raw; }
    if (f === 'width' && mentionedWidth(text, values.size || item.size, raw)) { used.push(f); return raw; }
    if (raw && mentions(text, raw)) { used.push(f); return raw; }
    return current;
  };
  for (const f of ['brand', 'size', 'width', 'material', 'color']) values[f] = keep(f);
  values.color_phrase = colorPhrase(values.color);
  values.brand_phrase = str(values.brand).trim();
  values.style = listingModel(item);
  if (!values.style) for (const rec of arr(item.id_photos)) {
    const token = str(rec?.text).trim();
    if (rec && typeof rec === 'object' && acceptToken(token)) { values.style = token; break; }
  }
  return { values, omitted, used: uniq(used), text, item, flags, style: values.style };
}

export function fnv1a32(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function factsFingerprint(item) {
  const facts = listingFacts(item), o = obj(item.opt_original) || {};
  const body = JSON.stringify({ values: facts.values, used: [...facts.used].sort(), photos: arr(item.photos),
    source_title: o.title || item.title || '', source_description: o.description || item.description || '' });
  return fnv1a32(body).toString(16).padStart(8, '0');
}
const possessive = who => { const s = str(who).trim(); return !s ? '' : /s$/i.test(s) ? `${s}'` : `${s}'s`; };
function genderToken(who) {
  const s = str(who).toLowerCase();
  return s.startsWith('women') ? 'womens' : s.startsWith('men') ? 'mens' : s.startsWith('kid') ? 'kids' : '';
}
function sizeToken(size, width) {
  const sz = str(size).toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '').replace(/^-+|-+$/g, '');
  const w = str(width).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return sz || w ? `${sz}${w}` : '';
}
const asciiSlug = text => str(text).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

// ---- copy.py ----
const pick = (seed, n) => (n <= 0 ? 0 : fnv1a32(seed) % n);
function clipWords(text, limit) {
  const t = str(text).replace(/\s+/g, ' ').trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit), sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim();
}
const join = (...parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
const styleOf = b => (b.style ? `style ${b.style}` : '');

function factBits(v, style) {
  const brand = str(v.brand_phrase || v.brand).trim(), who = v.sized_for ? possessive(v.sized_for) : '';
  const color = str(v.color_phrase || v.color).trim(), material = str(v.material).trim(), noun = str(v.noun).trim();
  const size = str(v.size).trim(), width = str(v.width).trim(), st = str(style).trim();
  const meas = [];
  if (v.sole_length) meas.push(`sole ${v.sole_length} in`);
  if (v.heel_height) meas.push(`heel ${v.heel_height} in`);
  if (v.shaft_height) meas.push(`shaft ${v.shaft_height} in`);
  if (v.shaft_circ) meas.push(`shaft circ ${v.shaft_circ} in`);
  return {
    brand, who, style: st, color, material, noun,
    size_line: [size && `size ${size}`, width && `${width} width`].filter(Boolean).join(' '),
    compact: `${size}${width}`.trim(), measures: meas.join(', '), toe: str(v.toe).trim(), heel: str(v.heel).trim(),
  };
}
export function seoTitle(v, style, id) {
  const b = factBits(v, style);
  const opts = [
    join(b.brand, b.who, b.style, b.color, b.material, b.noun, b.size_line),
    join(b.brand, b.style, b.noun, 'in', b.color, b.material, b.size_line),
    join(b.color, b.material, b.brand, b.noun, styleOf(b), b.size_line),
    join(b.brand, b.noun, styleOf(b), b.color, b.material, b.size_line),
  ].filter(Boolean);
  return opts.length ? opts[pick(`${id}|seo_title`, opts.length)] : 'Listing photo';
}
export function seoDescription(v, style, id, sourceDescription = '') {
  const b = factBits(v, style), c = b.compact;
  const leads = [
    join(b.brand, b.style, c && `size ${c}`, b.color),
    join(b.brand, b.noun, styleOf(b), b.size_line, b.color),
    join(b.color, b.material, b.brand, b.noun, c && `size ${c}`),
  ].filter(Boolean).map(x => x.replace(/[ .]+$/, ''));
  const lead = leads.length ? leads[pick(`${id}|seo_desc_lead`, leads.length)] : '';
  const rest = str(sourceDescription).replace(/\s+/g, ' ').trim();
  let body = lead && rest ? `${lead}. ${rest}` : (lead || rest);
  if (b.measures && !body.includes(b.measures)) body = `${body} ${b.measures.replace(/\.+$/, '')}.`.trim();
  return clipWords(body, 155);
}
export function altText(v, style, id, n, total) {
  const b = factBits(v, style);
  const opts = [
    join(b.brand, b.who, b.style, b.color, b.material, b.noun, b.size_line),
    join(b.color, b.material, b.brand, b.noun, styleOf(b), b.size_line),
    join(b.brand, b.noun, 'in', b.color, b.material, styleOf(b), b.size_line),
    join(b.brand, b.style, b.noun, b.color, b.material, b.size_line),
  ].filter(Boolean);
  const list = opts.length ? opts : ['listing photo'];
  const base = list[pick(`${id}|alt|${n}`, list.length)];
  return total > 1 ? `${base} - photo ${n} of ${total}` : n > 1 ? `${base} - photo ${n}` : base;
}
export function captionText(v, style, id, n, total) {
  const b = factBits(v, style);
  const opts = [
    `${join(b.brand, b.noun || 'photo', styleOf(b), b.color, b.material, b.size_line).trimEnd()}.`,
    `${join(b.color, b.material, b.brand, b.noun, b.style ? `, style ${b.style}` : '', b.size_line).trimEnd()}.`,
    `${join(b.brand, b.style, 'in', b.color, b.material, b.size_line).trimEnd()}.`,
  ];
  if (b.measures) opts.push(`${join(b.brand, b.noun, styleOf(b), b.size_line).trimEnd()}. ${b.measures[0].toUpperCase()}${b.measures.slice(1)}.`);
  if (b.toe || b.heel) opts.push(`${join(b.brand, b.noun, [b.toe, b.heel].filter(Boolean).join(', '), styleOf(b), b.size_line).trimEnd()}.`);
  const list = opts.filter(o => o && o !== '.');
  let cap = list.length ? list[pick(`${id}|caption|${n}`, list.length)] : 'Listing photo.';
  if (total > 1 && !cap.toLowerCase().includes(`photo ${n} of ${total}`)) cap = `${cap.replace(/\.+$/, '')}. Photo ${n} of ${total}.`;
  return cap;
}
export const titleText = (v, style, id, n) => (n ? `${seoTitle(v, style, id)} (photo ${n})` : seoTitle(v, style, id));
export function keywordList(v, style) {
  const bits = [v.brand, v.sized_for ? possessive(v.sized_for) : '', style, v.color_phrase || v.color, v.material, v.noun,
    v.size && `size ${v.size}`, v.width && `${v.width} width`, v.toe, v.heel];
  if (v.keywords) bits.push(...String(v.keywords).split(/\s*,\s*/));
  const out = [], seen = new Set();
  for (const b of bits) {
    const s = str(b).replace(/\s+/g, ' ').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase()); out.push(s);
  }
  return out;
}
export function creditLine(profile, seller) {
  const who = str(profile?.display_name || seller).trim();
  return who ? `${who} via westernbootworld.com` : 'westernbootworld.com';
}
export function slugTokens(v, style) {
  const slugs = t => asciiSlug(t).split('-').filter(Boolean);
  const seq = [...slugs(v.brand_phrase || v.brand)];
  const g = genderToken(v.sized_for);
  if (g) seq.push(g);
  seq.push(...slugs(style), ...slugs(str(v.color_phrase || v.color).replace(/,/g, ' ')), ...slugs(v.material), ...slugs(v.noun));
  const size = sizeToken(v.size, v.width);
  if (size) seq.push(size);
  const tokens = uniq(seq.filter(Boolean));
  const pinned = new Set(slugs(style));
  if (size) pinned.add(size);
  return { tokens, pinned };
}
export function packFilename(tokens, pinned, tail, maxLen = 80) {
  let room = maxLen - tail.length;
  if (room < 8) room = maxLen;
  const list = [...tokens];
  while (list.join('-').length > room && list.some(t => !pinned.has(t))) {
    let at = -1;
    for (let i = list.length - 1; i >= 0; i--) if (!pinned.has(list[i])) { at = i; break; }
    if (at < 0) break;
    list.splice(at, 1);
  }
  let name = list.join('-');
  if (name.length > room) {
    name = name.slice(0, room).replace(/-+$/, '');
    if (name.includes('-')) name = name.slice(0, name.lastIndexOf('-'));
  }
  return name ? `${name}${tail}` : tail.replace(/^-+/, '');
}
function fileName(v, style, n, taken, ext) {
  const e = !ext ? '.jpg' : ext.toLowerCase() === '.jpeg' ? '.jpg' : ext.toLowerCase();
  const { tokens, pinned } = slugTokens(v, style);
  let name = `${packFilename(tokens, pinned, `-${n}`)}${e}`;
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${packFilename(tokens, pinned, `-${n}-${k}`)}${e}`;
  taken.add(name.toLowerCase());
  return name;
}

// Text-only plan for one listing (no pixels): the same names and copy amcasoWBW writes into each photo.
export function planListing(input) {
  const facts = listingFacts(input), v = facts.values, id = input.id;
  const style = facts.style || listingModel(facts.item);
  const o = obj(input.opt_original) || {};
  const total = arr(input.photos).length;
  const credit = creditLine(input.seller_profile, input.seller);
  const kws = keywordList(v, style);
  const { tokens } = slugTokens(v, style);
  return {
    listing_id: id, facts, style, total, credit, keywords: kws,
    facts_fp: factsFingerprint(input),
    listing_slug: tokens.length ? tokens.join('-') : `listing-${id}`,
    seo_title: seoTitle(v, style, id),
    seo_description: seoDescription(v, style, id, str(input.description || o.description)),
    photo: n => ({ alt: altText(v, style, id, n, total), caption: captionText(v, style, id, n, total), title: titleText(v, style, id, n) }),
    fileName: (n, taken, ext) => fileName(v, style, n, taken, ext),
  };
}

// One listing plus its photo bytes in, an amcasoWBW-shaped result and prepared files out.
// sources: [{ n, bytes }] in photo order. A photo that cannot be read or prepared fails the whole listing (nothing partial is stored).
export async function runEngine(input, sources) {
  const plan = planListing(input);
  const taken = new Set(), images = [], files = [], errors = [], notes = [];
  for (let i = 0; i < plan.total; i++) {
    const n = i + 1, src = sources.find(s => Number(s.n) === n);
    const words = plan.photo(n);
    const meta = { title: words.title, description: words.caption, keywords: plan.keywords, credit: plan.credit, copyright: 'westernbootworld.com' };
    if (!src?.bytes?.length) { errors.push(`photo ${n}: ${src?.error || 'could not be read'}`); continue; }
    let prepared;
    try { prepared = await prepareWbwImage(src.bytes, meta); }
    catch (e) { errors.push(`photo ${n}: prepare failed (${e?.message || e})`); continue; }
    const filename = plan.fileName(n, taken, extFor(prepared.format) || '.jpg');
    for (const w of prepared.warnings) notes.push(`photo ${n}: ${w}`);
    images.push({ n, stored_url: input.photos[i], source: 'attached-bytes', view: null, view_source: null, confirm_queue: false,
      filename, file: filename, alt: words.alt, caption: words.caption, title: words.title, keywords: plan.keywords,
      width: prepared.width, height: prepared.height, gps_stripped: prepared.gps_stripped, format: prepared.format,
      converted: prepared.converted, converted_from: prepared.converted_from, metadata_written: prepared.metadata_written,
      orientation: prepared.orientation, color_mode: prepared.color_mode, warnings: prepared.warnings });
    files.push({ n, filename, bytes: prepared.image });
  }
  const v = plan.facts.values;
  const fields = Object.fromEntries(Object.entries(v).filter(([k, x]) => x != null && x !== '' && !['sized_label', 'brand_phrase', 'color_phrase', 'noun'].includes(k)));
  if (v.noun) fields.noun = v.noun;
  if (plan.style) fields.style = plan.style;
  const result = {
    ok: !errors.length, tool: 'amcasoWBW', version: ENGINE_VERSION, engine: ENGINE, listing_id: plan.listing_id, seller: input.seller,
    facts_fp: plan.facts_fp, reused_applied: false, reused_source: null, listing_slug: plan.listing_slug, fields,
    omitted: plan.facts.omitted, flags: plan.facts.flags, seo_title: plan.seo_title, seo_description: plan.seo_description,
    credit: plan.credit, images, confirm_queue: [], n_images: images.length, n_confirm: 0, notes, errors,
    warnings: images.flatMap(im => im.warnings), listing_text_readonly: true,
  };
  return { result, files };
}
