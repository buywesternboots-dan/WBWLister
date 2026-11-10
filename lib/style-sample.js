// Catalog cards. Exact maker + full style only. Not a live lookup.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv } from './csv';
import { listingModel } from './model';

export const MODELS_CSV = path.join(process.cwd(), 'data', 'wbw-reference', 'models.csv');
export const MAKERS_CSV = path.join(process.cwd(), 'data', 'wbw-reference', 'makers.csv');
export const CATALOG_SHA256 = 'd6e8c7a642712ee27d28b394c10062b6ccb762d188f9c385c77afebc44537e45';
export const CATALOG_DATE = '2026-11-08';
const RECORD_URL = /^https:\/\/www\.westernbootworld\.com\/lookup\/record\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_URL = /^https:\/\/www\.westernbootworld\.com\/library\/maker\/[a-z0-9-]+\/catalog(?:\?catalog_offset=\d+)?$/;
const STYLE_LINE = /^\s*style(?:\s+number)?\s*:\s*(\S(?:.*\S)?)\s*$/i;

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

export function parseStyleSample(input) {
  const doc = typeof input === 'string' ? JSON.parse(input) : input;
  const errors = [];
  const records = [];
  const seenUrl = new Set();
  const seenKey = new Map();
  for (const [i, row] of (doc?.records ?? []).entries()) {
    const line = i + 1;
    const record_url = String(row?.record_url ?? '').trim();
    const source_url = String(row?.provenance?.source_url ?? '').trim();
    if (!RECORD_URL.test(record_url) || !SOURCE_URL.test(source_url)) { errors.push({ row: line, error: 'Record link is not a catalog https URL.' }); continue; }
    if (seenUrl.has(record_url)) { errors.push({ row: line, error: 'Duplicate record link.' }); continue; }
    seenUrl.add(record_url);
    const style = row?.style_number;
    if (style != null && typeof style !== 'string') { errors.push({ row: line, error: 'Style must stay a string.' }); continue; }
    if (style != null && style !== style.trim()) { errors.push({ row: line, error: 'Style has surrounding space in the file.' }); continue; }
    const maker_name = String(row?.maker_name ?? '').trim();
    if (!maker_name) { errors.push({ row: line, error: 'Maker name is missing.' }); continue; }
    const rec = {
      maker_name, maker_slug: String(row.maker_slug ?? ''),
      record_title: String(row.record_title ?? ''),
      style_number: style ?? null,
      other_card_text: row.other_card_text ?? null,
      catalog_total_displayed: row.catalog_total_displayed,
      record_url, source_url,
      candidate_match_eligible: row.candidate_match_eligible === true && style != null,
      partial_sample: true,
      html_sha256: row?.provenance?.html_sha256 ?? null,
      csv_line: row?.provenance?.csv_line ?? null,
      record_page_opened: false,
    };
    records.push(rec);
    if (rec.style_number != null) {
      const key = `${maker_name}\n${rec.style_number}`;
      seenKey.set(key, (seenKey.get(key) ?? 0) + 1);
    }
  }
  const displayed = (doc?.coverage ?? []).reduce((n, c) => n + (Number(c.catalog_total_displayed) || 0), 0);
  return {
    records, errors, partial_sample: doc?.partial_sample === true, coverage: doc?.coverage ?? [],
    sample_records: records.length, displayed_records: displayed,
    ambiguous_keys: [...seenKey.entries()].filter(([, n]) => n > 1).map(([key]) => key),
  };
}

// Explicit style text only: the saved model field, or a "Style:" line. Not a search through the prose.
export function explicitStyles(item) {
  const out = [];
  if ((item?.verified ?? []).includes('id_text')) {
    const saved = String(item.id_text ?? '').trim();
    if (saved) out.push(saved);
  }
  const original = jsonField(item?.opt_original);
  const text = `${original?.description ?? item?.description ?? ''}`;
  for (const line of text.split(/\n/)) {
    const labeled = line.match(STYLE_LINE);
    if (labeled) out.push(labeled[1]);
  }
  return [...new Set(out)];
}

export function normStyle(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function normSlug(value) {
  return String(value ?? '').normalize('NFC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function styleKey(slug, style) {
  const n = normStyle(style);
  if (!slug || !n) return '';
  return `${slug}\n${n}`;
}

export function styleIndex(records) {
  const map = new Map();
  for (const rec of records ?? []) {
    if (!rec?.candidate_match_eligible) continue;
    const key = styleKey(rec.maker_slug || normSlug(rec.maker_name), rec.style_number);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(rec);
    else map.set(key, [rec]);
  }
  return map;
}

function makerNames(brand, sample) {
  const slug = normSlug(brand);
  const key = String(brand ?? '').trim().toLowerCase();
  if (!key && !slug) return [];
  if (sample.bySlug || sample.byName) {
    const names = new Set();
    const fromSlug = sample.bySlug?.get(slug);
    if (fromSlug) for (const name of fromSlug) names.add(name);
    const fromName = sample.byName?.get(key);
    if (fromName) names.add(fromName);
    return [...names];
  }
  const names = new Set();
  for (const rec of sample.records) {
    const name = String(rec.maker_name ?? '');
    if (name.toLowerCase() === key || rec.maker_slug === slug || normSlug(name) === slug) names.add(name);
  }
  return [...names];
}

function makerIndexes(records) {
  const bySlug = new Map();
  const byName = new Map();
  const slugByName = new Map();
  for (const rec of records) {
    if (!bySlug.has(rec.maker_slug)) bySlug.set(rec.maker_slug, new Set());
    bySlug.get(rec.maker_slug).add(rec.maker_name);
    byName.set(String(rec.maker_name ?? '').toLowerCase(), rec.maker_name);
    if (!slugByName.has(rec.maker_name)) slugByName.set(rec.maker_name, rec.maker_slug);
  }
  return { bySlug, byName, slugByName };
}

const SAMPLE_NOTE = 'This file is a partial catalog snapshot, 100 of 3058 displayed cards, not a complete model list. No match means the style was not in this snapshot. It does not mean the boot does not exist. Live lookup is not connected.';
const NOTE = 'This is the 2026-11-08 catalog snapshot, 12487 records across 87 makers. No match means that maker and full style number are not in the snapshot. It does not mean the boot does not exist. Live lookup is not connected.';
const noteFor = sample => sample?.partial_sample === true ? SAMPLE_NOTE : NOTE;

function candidate(rec) {
  return {
    maker_name: rec.maker_name, style_number: rec.style_number, record_title: rec.record_title,
    record_url: rec.record_url, source_url: rec.source_url, html_sha256: rec.html_sha256, csv_line: rec.csv_line,
    catalog_total_displayed: rec.catalog_total_displayed, partial_sample: rec.partial_sample !== false, record_page_opened: false,
    other_card_text: rec.other_card_text, other_card_text_unverified: true, adds_listing_facts: false,
  };
}

function sameCard(hits) {
  const urls = new Set(hits.map(h => h.record_url));
  const titles = new Set(hits.map(h => h.record_title));
  const cards = new Set(hits.map(h => h.other_card_text ?? ''));
  return urls.size === 1 && titles.size === 1 && cards.size === 1;
}

export function matchStyleSample(item, sample, brand) {
  const base = {
    partial_sample: sample?.partial_sample === true, sample_records: sample?.sample_records ?? 0,
    displayed_records: sample?.displayed_records ?? 0, snapshot_date: sample?.snapshot_date ?? null,
    live: false, adds_listing_facts: false,
  };
  const note = noteFor(sample);
  if (!sample?.records?.length) return { ...base, status: 'none', matches: [], note: 'No style snapshot is loaded. ' + note };
  const names = makerNames(brand, sample);
  const maker = names.length === 1 ? names[0] : null;
  const styles = [...new Set([...explicitStyles(item), listingModel(item)].filter(Boolean))];
  if (!maker || !styles.length) {
    return { ...base, status: 'none', matches: [], maker, styles, note: !styles.length ? 'No explicit style is saved on this listing. ' + note : names.length > 1 ? 'More than one maker matches that name. Nothing was chosen. ' + note : note };
  }
  const slug = sample.slugByName?.get(maker) || sample.records.find(r => r.maker_name === maker)?.maker_slug || normSlug(maker);
  const index = sample.index || (sample.index = styleIndex(sample.records));
  const matches = [];
  for (const style of styles) {
    const hits = index.get(styleKey(slug, style)) ?? [];
    if (!hits.length) continue;
    if (!sameCard(hits)) return { ...base, status: 'ambiguous', matches: [], maker, styles, note: 'More than one card has this maker and style. Nothing was chosen. ' + note };
    matches.push(candidate(hits[0]));
  }
  if (!matches.length) return { ...base, status: 'none', matches: [], maker, styles, note };
  return { ...base, status: 'candidate', matches, maker, styles, note: 'Candidate only. Keeping it stores the catalog link. It does not change the listing text or materials. ' + note };
}

export function acceptedStyleRef(match, recordUrl, now) {
  const hit = (match?.matches ?? []).find(m => m.record_url === recordUrl);
  if (!hit || match.status !== 'candidate') throw new Error('That catalog card is not a candidate for this listing.');
  return { ...hit, status: 'candidate', accepted_at: now ?? null };
}

function namesBySlug(csvText) {
  const map = new Map();
  for (const row of parseCsv(csvText)) {
    const slug = String(row.url ?? '').split('/maker/')[1]?.replace(/\/$/, '') ?? '';
    const name = String(row.name ?? '').trim();
    if (slug && name) map.set(slug, name);
  }
  return map;
}

// The committed models.csv. Style numbers stay strings, so leading zeros are kept. A blank style is not a match.
export function parseCatalogCsv(text, slugNames = new Map()) {
  const rows = parseCsv(text);
  const errors = [];
  const records = [];
  const seenUrl = new Set();
  rows.forEach((row, i) => {
    const line = i + 2;
    const record_url = String(row.record_url ?? '').trim();
    const source_url = String(row.source_url ?? '').trim();
    if (!RECORD_URL.test(record_url) || !SOURCE_URL.test(source_url)) { errors.push({ row: line, error: 'Record link is not a catalog https URL.' }); return; }
    if (seenUrl.has(record_url)) { errors.push({ row: line, error: 'Duplicate record link.' }); return; }
    seenUrl.add(record_url);
    const rawStyle = row.style_number == null ? '' : String(row.style_number);
    if (rawStyle !== rawStyle.trim()) { errors.push({ row: line, error: 'Style has surrounding space in the file.' }); return; }
    const style = rawStyle === '' ? null : rawStyle;
    const maker_slug = String(row.maker_slug ?? '').trim();
    if (!maker_slug) { errors.push({ row: line, error: 'Maker slug is missing.' }); return; }
    const card = String(row.other_card_text ?? '').trim();
    records.push({
      maker_name: slugNames.get(maker_slug) || maker_slug,
      maker_slug,
      record_title: String(row.record_title ?? ''),
      style_number: style,
      other_card_text: card || null,
      catalog_total_displayed: Number(row.maker_total_records_shown) || null,
      record_url, source_url,
      candidate_match_eligible: style != null,
      partial_sample: false,
      record_page_opened: false,
    });
  });
  const index = styleIndex(records);
  const { bySlug, byName, slugByName } = makerIndexes(records);
  return {
    records, errors, index, bySlug, byName, slugByName,
    partial_sample: false, coverage: [], sample_records: records.length, displayed_records: records.length,
    ambiguous_keys: [], snapshot_date: CATALOG_DATE, source_sha256: CATALOG_SHA256,
  };
}

let cache;
export function bundledStyleSample() {
  if (cache) return cache;
  try {
    cache = parseCatalogCsv(readFileSync(MODELS_CSV, 'utf8'), namesBySlug(readFileSync(MAKERS_CSV, 'utf8')));
  } catch {
    cache = { records: [], errors: [{ row: 0, error: 'Style snapshot is not on this server.' }], partial_sample: false, coverage: [], sample_records: 0, displayed_records: 0, ambiguous_keys: [], snapshot_date: CATALOG_DATE, source_sha256: CATALOG_SHA256 };
  }
  return cache;
}
