// Style numbers and stock codes read from the listing's own words. No lookup and no invented ids.
import { listingFacts } from './facts';

const LABEL = /\b(model|style|lot|sku)(?:\s+(?:number|no\.?))?\s*[#:]\s*([A-Za-z0-9][A-Za-z0-9-]*)|\b(model|style|lot|sku)\s+(?:number|no\.?)\s+([A-Za-z0-9][A-Za-z0-9-]*)/gi;
const SIZE_TOKEN = /^(?:\d{1,2}(?:\.5)?)(?:-?[a-e]{1,4})?$/i;
const STOCK_LEAD = /^([A-Za-z]{2,}#[A-Za-z0-9][A-Za-z0-9-]*)\b\s*/;
const COMPOUND_COLOR = /^(black cherry|chocolate brown)$/i;
const COLOR_WORD = /^(black|brown|tan|cognac|chocolate|honey|red|bone|white|grey|gray|blue|green|burgundy|oxblood|natural|camel|saddle|rust|cherry)$/i;

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

// A size, width, or price is not a style number. Leading zeros stay in the caller's string.
export function acceptToken(token) {
  const t = String(token ?? '').trim();
  if (!t || t.length > 20) return false;
  if (SIZE_TOKEN.test(t) || /^[a-e]{1,4}$/i.test(t)) return false;
  if (/^\$/.test(t) || /^\d+\.\d{2}$/.test(t)) return false;
  const digits = t.replace(/\D/g, '');
  if (digits.length < 3 || /^0+$/.test(digits)) return false;
  return true;
}

// Labeled only: Model / Style / Lot / SKU, with : or #, or "No." / "number". A glued SKU#code is an inventory ref.
export function extractModel(text) {
  const src = String(text ?? '');
  for (const m of src.matchAll(new RegExp(LABEL.source, 'gi'))) {
    const label = String(m[1] || m[3] || '').toLowerCase();
    const token = m[2] || m[4] || '';
    if (label === 'sku' && /^sku#[a-z0-9]/i.test(m[0].trim())) continue;
    if (acceptToken(token)) return token;
  }
  return '';
}

function styleField(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > 40) return '';
  const parts = s.split(/\s+/);
  if (parts.length > 3 || !parts.every(p => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(p) && acceptToken(p))) return '';
  return s;
}

export function listingModel(item) {
  const original = jsonField(item?.opt_original);
  const texts = [
    `${item?.title ?? ''}\n${item?.description ?? ''}`,
    `${original?.title ?? ''}\n${original?.description ?? ''}`,
  ];
  for (const text of texts) {
    const found = extractModel(text);
    if (found) return found;
  }
  if ((item?.verified ?? []).includes('id_text')) return styleField(item.id_text);
  return '';
}

export function colorPhrase(color) {
  const parts = String(color ?? '').split(/\s*(?:,|\/|&|\band\b)\s*/i).flatMap(part => {
    const bit = part.trim();
    if (!bit) return [];
    if (COMPOUND_COLOR.test(bit)) return [bit.replace(/\b\w/g, c => c.toUpperCase())];
    const words = bit.split(/\s+/);
    if (words.length > 1 && words.every(w => COLOR_WORD.test(w))) return words.map(w => w.charAt(0).toUpperCase() + w.slice(1));
    return [bit];
  });
  return parts.join(', ');
}

function tidy(s) {
  return String(s ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripTags(s) {
  return String(s ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?[a-z][^>\n]*>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

// Moves a leading Boots# / SKU# token to Ref and turns ==Heading== into its own line. Other words stay as written.
export function reshapePlain(text) {
  let body = tidy(stripTags(text));
  let ref = '';
  const lead = body.match(STOCK_LEAD);
  if (lead && !/^(model|style|lot)$/i.test(lead[1].split('#')[0])) {
    ref = lead[1];
    body = body.slice(lead[0].length);
  }
  body = body.replace(/==\s*([^=\n]+?)\s*==/g, (_, h) => `\n\n${h.trim()}\n\n`);
  return { text: tidy(body), ref };
}

export function leadLine(values, model) {
  const size = values?.size && values?.width ? `size ${values.size} ${values.width} width`
    : values?.size ? `size ${values.size}`
      : values?.width ? `${values.width} width` : '';
  const head = [values?.brand, model].filter(Boolean).join(' ');
  const line = [head, size, colorPhrase(values?.color)].filter(Boolean).join(', ');
  return line ? `${line}.` : '';
}

function sourceDescription(item) {
  const original = jsonField(item?.opt_original);
  const live = item?.description;
  if (live != null && String(live).trim()) return String(live);
  return String(original?.description ?? '');
}

function sourceText(item) {
  const original = jsonField(item?.opt_original);
  return [item?.title, item?.description, original?.title, original?.description].filter(v => v != null).join('\n');
}

function mentions(text, value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i').test(text);
}

function mentionedSize(text, size) {
  const s = String(size ?? '').trim();
  if (!s) return false;
  const sizeEsc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b(?:size\\s*:?\\s*)?${sizeEsc}(?:\\s*-?\\s*[a-e]{1,4})?\\b`, 'i').test(text);
}

function mentionedWidth(text, size, width) {
  const w = String(width ?? '').trim();
  if (!w) return false;
  const sizeEsc = String(size ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const widthEsc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (sizeEsc && new RegExp(`\\b${sizeEsc}\\s*-?\\s*${widthEsc}\\b`, 'i').test(text)) return true;
  return new RegExp(`\\bwidth\\s*:?\\s*${widthEsc}\\b`, 'i').test(text);
}

const COLOR = 'black cherry|chocolate brown|black|brown|tan|cognac|chocolate|honey|red|bone|white|grey|gray|blue|green|burgundy|oxblood|natural|camel|saddle|rust|cherry';
const COLOR_PAIR = new RegExp(`\\b(${COLOR})\\s+(?:and\\s+)?(${COLOR})\\b`, 'i');

function colorPair(text) {
  const m = String(text ?? '').match(COLOR_PAIR);
  if (!m || m[1].toLowerCase() === m[2].toLowerCase()) return '';
  const show = w => w.replace(/\b\w/g, c => c.toUpperCase());
  return `${show(m[1])} ${show(m[2])}`;
}

function mergeColor(field, pair) {
  if (!pair) return field || '';
  if (!field) return pair;
  const words = pair.toLowerCase().split(/\s+/);
  if (!/\s/.test(String(field)) && words.includes(String(field).toLowerCase())) return pair;
  return field;
}

// Filename and SEO facts. A stored field is used when it is already reliable, or when the listing text says that same value.
// A guess that is not written in the listing stays out. "Liberty Boots Co" keeps the company words, with boot singular so "cowboy boots" is not eaten.
export function imageValues(item, base) {
  const values = { ...(base ?? listingFacts(item).values) };
  const text = sourceText(item);
  const keep = (field, value) => values[field] || (value && mentions(text, value) ? value : '');
  const size = values.size || (mentionedSize(text, item?.size) ? item.size : '');
  const width = values.width || (mentionedWidth(text, size || item?.size, item?.width) ? item.width : '');
  const pair = colorPair(text);
  const brand = keep('brand', item?.brand);
  return {
    ...values,
    brand,
    brand_phrase: brandPhrase(brand, text),
    sized_for: values.sized_for,
    size, width,
    material: keep('material', item?.material),
    color: mergeColor(keep('color', item?.color), pair),
  };
}

export function brandPhrase(brand, text) {
  const name = String(brand ?? '').trim();
  if (!name) return '';
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+boots?\\s+co(?:mpany)?\\b`, 'i');
  return re.test(text) ? `${name} Boot Co` : name;
}

function clipWords(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim();
}

// Images-seo meta. Never opens with an inventory code. About 155 characters.
export function seoBlurb(item, values) {
  const v = values ?? imageValues(item);
  const model = listingModel(item);
  const { text } = reshapePlain(sourceDescription(item));
  const compact = `${v.size ?? ''}${v.width ?? ''}`.trim();
  const lead = [v.brand, model, compact && `size ${compact}`, colorPhrase(v.color)].filter(Boolean).join(' ');
  const rest = text.replace(/\s+/g, ' ').trim();
  const body = lead && rest ? `${lead}. ${rest}` : (lead || rest);
  return clipWords(body, 155);
}
