// Factual fields shared by wording, photo names, and XMP. No network and no node-only modules.

const GENDER = /\b(men(?:'?s)?|mens|women(?:'?s)?|womens|kids|man|woman|ladies|youth)\b/i;

export function possessive(who) {
  const s = String(who ?? '').trim();
  if (!s) return '';
  return /s$/i.test(s) ? `${s}'` : `${s}'s`;
}

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};
const has = v => v != null && String(v).trim() !== '';

function usable(item, field) {
  if (!has(item[field])) return false;
  return !(item.guessed ?? []).includes(field) || (item.verified ?? []).includes(field);
}

// Fields safe to say in new wording. Guessed values and silent defaults stay out.
export function listingFacts(item) {
  const original = jsonField(item?.opt_original);
  const text = `${original?.title ?? item?.title ?? ''}\n${original?.description ?? item?.description ?? ''}`;
  const verified = new Set(item?.verified ?? []);
  const omitted = [], used = [];
  const take = (field, ok = usable(item, field)) => {
    if (ok && has(item[field])) { used.push(field); return item[field]; }
    if (has(item[field]) || (item?.guessed ?? []).includes(field)) {
      const inferred = (item.guessed ?? []).includes(field) && !verified.has(field);
      omitted.push({ field, reason: inferred
        ? 'Inferred from the listing and not verified, so it is left out of the new wording.'
        : 'Left out of the new wording because the listing does not state it.' });
    }
    return null;
  };
  const stated = GENDER.test(text);
  const gender = take('sized_for', has(item.sized_for) && (verified.has('sized_for') || stated) && (usable(item, 'sized_for') || stated));
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
    noun: item?.boot === 'belt' ? 'belt' : item?.boot === 'boot' ? 'cowboy boots' : '',
  };
  return { values, omitted, used, text };
}

export function photoBits(item) {
  const { values } = listingFacts(item);
  const who = values.sized_for ? possessive(values.sized_for) : '';
  return [values.brand, who, values.color, values.material, values.noun, values.size && `size ${values.size}`, values.width && `${values.width} width`].filter(Boolean);
}

// Stable hash of the facts a draft was built from. A later edit or re-import changes it.
export function factsFingerprint(item) {
  const original = jsonField(item?.opt_original);
  const { values, used } = listingFacts(item);
  const body = JSON.stringify({
    values, used: [...used].sort(), photos: [...(item?.photos ?? [])],
    source_title: original?.title ?? item?.title ?? '',
    source_description: original?.description ?? item?.description ?? '',
  });
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) { h ^= body.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
