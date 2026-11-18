// Numbers and codes read off boot photos. Every hit is a candidate: from the photo,
// not verified, and never copied onto size, width, or the style field.
export const PHOTO_TYPES = ['style', 'size', 'width', 'serial', 'other', 'unknown'];

const SIZE = /\b(\d{1,2}(?:\.\d+)?(?:\s+\d\/\d)?)\s*([A-Z]{1,4}|[2-4]E)\b/i;
const WIDTH_WORD = /\bwidth\s*[:#]?\s*([A-Z]{1,4}|[2-4]E)\b/i;
const STYLE = /\b(?:style|model)(?:\s*(?:number|no\.?))?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{2,})/i;
const SERIAL = /\b(?:serial|lot|s\/n|sn)(?:\s*(?:number|no\.?))?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{2,})/i;
const DATE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/;
const FACTORY = /\b(?:factory|plant|code)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{1,})/i;

function push(found, text, photo, type) {
  const value = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!value || !PHOTO_TYPES.includes(type)) return;
  if (found.some(f => f.text.toLowerCase() === value.toLowerCase() && f.type === type)) return;
  found.push({ text: value, photo, type, from_photo: true, verified: false });
}

// One OCR string from one photo → candidates. photo is the 1-based photo number.
export function classifyPhotoText(raw, photo) {
  const found = [];
  const src = String(raw ?? '');
  for (const line of src.split(/\n/)) {
    const style = line.match(STYLE);
    if (style && /\d/.test(style[1]) && !/^\d{1,2}(?:\.\d+)?(?:\s*[A-Z]{1,4})?$/i.test(style[1])) push(found, style[1], photo, 'style');
    const size = line.match(SIZE);
    if (size) {
      push(found, `${size[1]} ${size[2].toUpperCase()}`, photo, 'size');
      push(found, size[2].toUpperCase(), photo, 'width');
    }
    const width = line.match(WIDTH_WORD);
    if (width) push(found, width[1].toUpperCase(), photo, 'width');
    const serial = line.match(SERIAL);
    if (serial) push(found, serial[1], photo, 'serial');
    const date = line.match(DATE);
    if (date) push(found, date[1], photo, 'serial');
    const factory = line.match(FACTORY);
    if (factory && !/^(?:size|width|style|model)$/i.test(factory[1])) push(found, factory[1], photo, 'other');
  }
  for (const tok of src.match(/[A-Za-z]*\d[A-Za-z0-9/-]*/g) ?? []) {
    if (found.some(f => f.text.replace(/\s/g, '').toLowerCase().includes(tok.toLowerCase()))) continue;
    const type = /^\d{1,2}(?:\.\d+)?$/.test(tok) ? 'unknown' : 'other';
    push(found, tok, photo, type);
  }
  return found;
}

// recognize(photoUrl, photoNumber) → text. A failure on one photo skips that photo.
export async function readPhotoCodes(photos, recognize) {
  const out = [];
  for (let i = 0; i < (photos ?? []).length; i++) {
    let text = '';
    try { text = await recognize(photos[i], i + 1); } catch { text = ''; }
    if (text) out.push(...classifyPhotoText(text, i + 1));
  }
  return out;
}

// The only fields a photo read may write. Listing size, width, and style stay as they were.
export function photoCodePatch(codes) {
  return { photo_codes: codes ?? [] };
}
