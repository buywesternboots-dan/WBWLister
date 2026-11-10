// Structured fields filled only from an exact maker or an exact maker + full style.
import { makerKey } from './wbw-ref';
import { exactMaker } from './maker-note';
import { normStyle } from './style-sample';
import { MATERIALS } from './vocab';

export function exactMaterialName(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  const hits = MATERIALS.filter(m => m.name.toLowerCase() === s || m.aliases.some(a => a.toLowerCase() === s));
  return hits.length === 1 ? hits[0].name : '';
}

function dropGuess(fields, item, field) {
  fields.guessed = (fields.guessed ?? item.guessed ?? []).filter(f => f !== field);
}

export function applyExactFields(fields, item, proposal, directory) {
  const verified = new Set(item?.verified ?? []);
  const photos = fields.photos ?? item?.photos ?? [];
  const maker = exactMaker(fields.brand ?? item?.brand, directory);
  const flags = {
    brand_exact: !!maker,
    style_status: 'blank',
    material_status: 'none',
    photo_order: 'source',
    first_photo: photos.length ? 1 : null,
  };
  if (maker) {
    const current = String(fields.brand ?? item?.brand ?? '');
    if (!verified.has('brand') || makerKey(current) === makerKey(maker.name)) {
      fields.brand = maker.name;
      dropGuess(fields, item, 'brand');
    }
  }
  const sample = proposal?.style_sample;
  const styles = sample?.styles ?? [];
  if (sample?.status === 'ambiguous') flags.style_status = 'ambiguous';
  else if (sample?.status === 'candidate' && sample.matches?.length === 1) {
    flags.style_status = 'matched';
    const match = sample.matches[0];
    const style = match.style_number;
    const current = String(fields.id_text ?? item?.id_text ?? '').trim();
    if (style && (!current || !verified.has('id_text') || normStyle(current) === normStyle(style))) {
      fields.id_text = style;
      dropGuess(fields, item, 'id_text');
    }
    const mat = exactMaterialName(match.other_card_text);
    const curMat = String(fields.material ?? item?.material ?? '').trim();
    const curExact = exactMaterialName(curMat);
    if (mat && curExact && curExact !== mat) flags.material_status = 'needs-human';
    else if (mat && (!curMat || !verified.has('material') || curExact === mat)) {
      fields.material = mat;
      dropGuess(fields, item, 'material');
      flags.material_status = 'applied';
    } else if (match.other_card_text && !curExact) flags.material_status = 'needs-human';
  } else if (styles.length) flags.style_status = 'none';
  return flags;
}
