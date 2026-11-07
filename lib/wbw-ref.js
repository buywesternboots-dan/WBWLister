// Untrusted read-only snapshot of the public maker directory. No network. Not a model catalog.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv } from './csv';

// Literal project path. next.config outputFileTracingIncludes copies this into the server bundle.
export const MAKERS_CSV = path.join(process.cwd(), 'data', 'wbw-reference', 'makers.csv');

export const REFERENCE_FETCHED_AT = '2026-11-07T15:35:00-05:00';
const COLS = ['section', 'name', 'location', 'search_blurb', 'url', 'source_url'];
const SECTIONS = new Set(['manufacturers', 'bootmakers']);
const MAX_CELL = 2000;

export function makerKey(name) {
  return String(name ?? '').normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function clean(v) {
  return String(v ?? '').replace(/\u0000/g, '').normalize('NFC').trim();
}

// Directory rows. search_blurb and location are kept for audit only and are not boot facts.
export function parseMakerDirectory(csvText) {
  const text = String(csvText ?? '');
  const errors = [];
  if (text.includes('\uFFFD') || text.includes('\u0000')) {
    return { makers: [], errors: [{ row: 0, error: 'Maker file is not valid text.' }], fetched_at: REFERENCE_FETCHED_AT, counts: { manufacturers: 0, bootmakers: 0 } };
  }
  const rows = parseCsv(text);
  const header = rows[0] ? Object.keys(rows[0]) : [];
  for (const col of COLS) if (!header.includes(col)) errors.push({ row: 1, error: `Missing column ${col}.` });
  if (errors.length) return { makers: [], errors, fetched_at: REFERENCE_FETCHED_AT, counts: { manufacturers: 0, bootmakers: 0 } };
  const makers = [], seen = new Map();
  rows.forEach((row, i) => {
    const name = clean(row.name), section = clean(row.section), url = clean(row.url), source_url = clean(row.source_url);
    const location = clean(row.location), search_blurb = clean(row.search_blurb);
    const line = i + 2;
    if (!name || !section || !url || !source_url) { errors.push({ row: line, error: 'A maker row is missing its name or source.' }); return; }
    if (!SECTIONS.has(section)) { errors.push({ row: line, error: 'Unknown maker section.' }); return; }
    if ([name, section, url, source_url, location, search_blurb].some(v => v.length > MAX_CELL)) { errors.push({ row: line, error: 'A maker field is too long.' }); return; }
    if (/^[=+\-@]/.test(name)) { errors.push({ row: line, error: 'A maker name is not a plain name.' }); return; }
    const key = makerKey(name);
    if (!key) { errors.push({ row: line, error: 'A maker name is empty after cleanup.' }); return; }
    if (seen.has(key)) { errors.push({ row: line, error: `Duplicate maker ${name}.` }); return; }
    seen.set(key, name);
    makers.push({ section, name, location, search_blurb, url, source_url, fetched_at: REFERENCE_FETCHED_AT, applies_to_boot: false });
  });
  return {
    makers, errors, fetched_at: REFERENCE_FETCHED_AT,
    counts: { manufacturers: makers.filter(m => m.section === 'manufacturers').length, bootmakers: makers.filter(m => m.section === 'bootmakers').length },
  };
}

// Detail pages are excerpts. fields stayed empty in this pull; nothing here is a model number.
export function parseMakerSamples(jsonText) {
  let data;
  try { data = JSON.parse(String(jsonText ?? '')); }
  catch { throw new Error('Maker samples are not a list.'); }
  if (!Array.isArray(data)) throw new Error('Maker samples are not a list.');
  return data.map(s => ({
    url: clean(s?.url), title: clean(s?.title), headings: Array.isArray(s?.headings) ? s.headings.map(clean) : [],
    text_excerpt: clean(s?.text_excerpt).slice(0, 8000), text_len: Number(s?.text_len) || 0,
    fields: s?.fields && typeof s.fields === 'object' && !Array.isArray(s.fields) ? s.fields : {},
    excerpt: true, product_fact: false, fetched_at: REFERENCE_FETCHED_AT,
  }));
}

export function assertLookupUnavailable(markdown) {
  const text = String(markdown ?? '');
  if (!/BLOCKER/i.test(text) || !/not fetched/i.test(text)) throw new Error('Lookup snapshot does not show model results as unavailable.');
  return { available: false, fetched_at: REFERENCE_FETCHED_AT, reason: 'This snapshot has no model or style results. Live lookup is not connected.' };
}

// Exact directory name only. No fuzzy match and no location copied onto a boot.
export function suggestMaker(brand, makers) {
  const key = makerKey(brand);
  if (!key) return null;
  const hits = (makers ?? []).filter(m => makerKey(m.name) === key);
  if (hits.length !== 1) return null;
  const m = hits[0];
  return {
    name: m.name, section: m.section, url: m.url, source_url: m.source_url, fetched_at: m.fetched_at || REFERENCE_FETCHED_AT,
    applies_to_boot: false, use_in_listing: 'spelling',
  };
}

let cache;
export function bundledDirectory() {
  if (cache) return cache;
  try {
    const csv = readFileSync(MAKERS_CSV, 'utf8');
    cache = parseMakerDirectory(csv);
  } catch {
    cache = { makers: [], errors: [{ row: 0, error: 'Maker snapshot is not on this server.' }], fetched_at: null, counts: { manufacturers: 0, bootmakers: 0 } };
  }
  return cache;
}
