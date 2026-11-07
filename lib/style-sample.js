// Partial catalog cards. Exact maker + explicit style only. Not a model database and not a live lookup.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const STYLE_SAMPLE_JSON = path.join(process.cwd(), 'data', 'wbw-reference', 'models_sample.normalized.json');
const RECORD_URL = /^https:\/\/www\.westernbootworld\.com\/lookup\/record\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_URL = /^https:\/\/www\.westernbootworld\.com\/library\/maker\/[a-z0-9-]+\/catalog$/;
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

function makerName(brand, sample) {
  const key = String(brand ?? '').trim().toLowerCase();
  if (!key) return null;
  const names = [...new Set(sample.records.map(r => r.maker_name).filter(name => name.toLowerCase() === key))];
  return names.length === 1 ? names[0] : null;
}

const NOTE = 'This file is a partial catalog snapshot, 100 of 3058 displayed cards, not a complete model list. No match means the style was not in this snapshot. It does not mean the boot does not exist. Live lookup is not connected.';

function candidate(rec) {
  return {
    maker_name: rec.maker_name, style_number: rec.style_number, record_title: rec.record_title,
    record_url: rec.record_url, source_url: rec.source_url, html_sha256: rec.html_sha256, csv_line: rec.csv_line,
    catalog_total_displayed: rec.catalog_total_displayed, partial_sample: true, record_page_opened: false,
    other_card_text: rec.other_card_text, other_card_text_unverified: true, adds_listing_facts: false,
  };
}

export function matchStyleSample(item, sample, brand) {
  const base = { partial_sample: true, sample_records: sample?.sample_records ?? 0, displayed_records: sample?.displayed_records ?? 0, live: false, adds_listing_facts: false };
  if (!sample?.records?.length) return { ...base, status: 'none', matches: [], note: 'No style snapshot is loaded. ' + NOTE };
  const maker = makerName(brand, sample);
  const styles = explicitStyles(item);
  if (!maker || !styles.length) {
    return { ...base, status: 'none', matches: [], maker, styles, note: !styles.length ? 'No explicit style is saved on this listing. ' + NOTE : NOTE };
  }
  const matches = [];
  for (const style of styles) {
    const key = `${maker}\n${style}`;
    if ((sample.ambiguous_keys ?? []).includes(key)) return { ...base, status: 'ambiguous', matches: [], maker, styles, note: 'More than one card has this maker and style. Nothing was chosen. ' + NOTE };
    const hits = sample.records.filter(r => r.maker_name === maker && r.style_number === style && r.candidate_match_eligible);
    if (hits.length > 1) return { ...base, status: 'ambiguous', matches: [], maker, styles, note: 'More than one card has this maker and style. Nothing was chosen. ' + NOTE };
    if (hits.length === 1) matches.push(candidate(hits[0]));
  }
  if (!matches.length) return { ...base, status: 'none', matches: [], maker, styles, note: NOTE };
  return { ...base, status: 'candidate', matches, maker, styles, note: 'Candidate only. Keeping it stores the catalog link. It does not change the listing text or materials. ' + NOTE };
}

export function acceptedStyleRef(match, recordUrl, now) {
  const hit = (match?.matches ?? []).find(m => m.record_url === recordUrl);
  if (!hit || match.status !== 'candidate') throw new Error('That catalog card is not a candidate for this listing.');
  return { ...hit, status: 'candidate', accepted_at: now ?? null };
}

let cache;
export function bundledStyleSample() {
  if (cache) return cache;
  try { cache = parseStyleSample(readFileSync(STYLE_SAMPLE_JSON, 'utf8')); }
  catch { cache = { records: [], errors: [{ row: 0, error: 'Style snapshot is not on this server.' }], partial_sample: true, coverage: [], sample_records: 0, displayed_records: 0, ambiguous_keys: [] }; }
  return cache;
}
