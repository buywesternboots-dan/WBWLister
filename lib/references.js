// Seller-entered maker/model notes. This is not the Western Boot World maker library or boot lookup.
import { brandName } from './vocab';

export const REFERENCE_LIMITS = { maker: 80, model: 80, provenance: 300, notes: 500, rows: 50, csvBytes: 100000 };

export const REFERENCE_NOTE = 'A read-only maker directory snapshot from 2026-11-07 can only confirm that a maker name is listed. It does not say where a pair was made, and it has no model or style lookup. Live Western Boot World lookup is not connected. A note you add is not a live lookup.';

const WIDTHISH = /^(a{1,4}|e{1,4}|[b-dfmnw]|[2-4][ae])$/i;

function cap(label, value, max) {
  const s = String(value ?? '').trim();
  if (s.length > max) throw new Error(`${label} is too long.`);
  return s;
}

export function referenceFromFields(input) {
  const maker = cap('Maker', input?.maker, REFERENCE_LIMITS.maker);
  const provenance = cap('Provenance', input?.provenance, REFERENCE_LIMITS.provenance);
  if (!maker) throw new Error('Maker is required.');
  if (!provenance) throw new Error('Say where this note came from.');
  const status = String(input?.status ?? 'candidate').trim().toLowerCase();
  if (status !== 'confirmed' && status !== 'candidate') throw new Error('Status must be confirmed or candidate.');
  return { maker, model: cap('Model', input?.model, REFERENCE_LIMITS.model), status, provenance, notes: cap('Notes', input?.notes, REFERENCE_LIMITS.notes) };
}

export function referenceKey(row) {
  return `${String(row?.maker ?? '').trim().toLowerCase()}\n${String(row?.model ?? '').trim().toLowerCase()}`;
}

// Lines: maker | model | status | provenance | notes. A header row is skipped. Bad lines are returned, not invented.
export function assertReferencePost(body) {
  if (typeof body?.csv === 'string') {
    if (body.csv.length > REFERENCE_LIMITS.csvBytes) throw new Error('That note file is too large.');
    return parseReferenceTable(body.csv);
  }
  return { rows: [referenceFromFields(body)], errors: [] };
}

export function parseReferenceTable(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const data = lines.filter(line => {
    const cells = line.split('|').map(c => c.trim());
    return !(/^maker$/i.test(cells[0]) && cells.some(c => /^provenance$/i.test(c)));
  });
  if (data.length > REFERENCE_LIMITS.rows) return { rows: [], errors: [{ line: '', error: `No more than ${REFERENCE_LIMITS.rows} notes at a time.` }] };
  const rows = [], errors = [];
  for (const line of lines) {
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
