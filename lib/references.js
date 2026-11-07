// Seller-entered maker/model notes. This is not the Western Boot World maker library or boot lookup.
import { brandName } from './vocab';

export const REFERENCE_NOTE = 'Western Boot World maker library and boot lookup are not connected. This uses the listing you imported and any maker or model notes you enter here. A note is not a live lookup.';

const WIDTHISH = /^(a{1,4}|e{1,4}|[b-dfmnw]|[2-4][ae])$/i;

export function referenceFromFields(input) {
  const maker = String(input?.maker ?? '').trim();
  const provenance = String(input?.provenance ?? '').trim();
  if (!maker) throw new Error('Maker is required.');
  if (!provenance) throw new Error('Say where this note came from.');
  const status = String(input?.status ?? 'candidate').trim().toLowerCase();
  if (status !== 'confirmed' && status !== 'candidate') throw new Error('Status must be confirmed or candidate.');
  return { maker, model: String(input?.model ?? '').trim(), status, provenance, notes: String(input?.notes ?? '').trim() };
}

// Lines: maker | model | status | provenance | notes. A header row is skipped. Bad lines are returned, not invented.
export function parseReferenceTable(text) {
  const rows = [], errors = [];
  for (const line of String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const cells = line.split('|').map(c => c.trim());
    if (/^maker$/i.test(cells[0]) && cells.some(c => /^provenance$/i.test(c))) continue;
    const [maker, model, status, provenance, notes] = cells;
    try { rows.push(referenceFromFields({ maker, model, status, provenance, notes })); }
    catch (e) { errors.push({ line, error: e.message }); }
  }
  return { rows, errors };
}

function modelInText(model, text) {
  const m = String(model ?? '').trim();
  if (m.length < 2 || WIDTHISH.test(m)) return false;
  const re = new RegExp(`(?:^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i');
  return re.test(text);
}

// Confirmed notes are used only when this listing already names that maker and model.
export function matchReferences(item, refs) {
  const itemName = brandName(item?.brand || '').toLowerCase();
  const hay = `${item?.title ?? ''}\n${item?.description ?? ''}${(item?.verified ?? []).includes('id_text') ? `\n${item.id_text ?? ''}` : ''}`;
  const matches = (refs ?? []).map(r => {
    const makerOk = !!itemName && brandName(r.maker).toLowerCase() === itemName;
    if (!makerOk) return { ...r, use: false, reason: 'Maker does not match this listing.' };
    if (!String(r.model ?? '').trim()) return { ...r, use: false, reason: 'Note has no model.' };
    if (r.status !== 'confirmed') return { ...r, use: false, reason: 'Note is still a candidate.' };
    if (!modelInText(r.model, hay)) return { ...r, use: false, reason: 'Model is not named in this listing.' };
    return { ...r, use: true, reason: 'Confirmed note, and the listing already names this model.' };
  });
  return { connected: false, note: REFERENCE_NOTE, matches };
}
