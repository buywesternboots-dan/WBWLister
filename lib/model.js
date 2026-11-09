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

function clipWords(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim();
}

// Images-seo meta. Never opens with an inventory code. About 155 characters.
export function seoBlurb(item, values) {
  const v = values ?? listingFacts(item).values;
  const model = listingModel(item);
  const { text } = reshapePlain(sourceDescription(item));
  const compact = `${v.size ?? ''}${v.width ?? ''}`.trim();
  const lead = [v.brand, model, compact && `size ${compact}`, colorPhrase(v.color)].filter(Boolean).join(' ');
  const rest = text.replace(/\s+/g, ' ').trim();
  const body = lead && rest ? `${lead}. ${rest}` : (lead || rest);
  return clipWords(body, 155);
}
