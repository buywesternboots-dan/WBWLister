// One CSV cell. A leading = + - @, tab, or CR would be a formula in Excel, so those are quoted as text.
// A description that starts with "- " is prose, not a formula.
export function csvCell(v) {
  const s = String(Array.isArray(v) ? v.join('|') : v ?? '');
  const safe = /^[\t\r=+\-@]/.test(s) && !s.startsWith('- ') ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Records of a CSV, including quoted newlines. A leading UTF-8 BOM is ignored. The trailing newline is not a row.
export function csvRecords(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const out = [];
  let start = 0, q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (q && s[i + 1] === '"') { i++; continue; }
      q = !q;
      continue;
    }
    if (!q && (c === '\n' || c === '\r')) {
      out.push(s.slice(start, i));
      if (c === '\r' && s[i + 1] === '\n') i++;
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  if (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function parseRecord(rec) {
  const row = [];
  let cell = '', q = false;
  for (let i = 0; i < rec.length; i++) {
    const c = rec[i];
    if (q) {
      if (c === '"') {
        if (rec[i + 1] === '"') { cell += '"'; i++; continue; }
        q = false;
        continue;
      }
      cell += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    cell += c;
  }
  row.push(cell);
  return row;
}

// Header row → objects. Quoted commas and newlines stay inside the cell.
export function parseCsv(text) {
  const recs = csvRecords(text);
  if (!recs.length) return [];
  const headers = parseRecord(recs[0]).map(h => h.trim());
  return recs.slice(1).filter(r => r.trim()).map(r => {
    const cells = parseRecord(r);
    const obj = {};
    headers.forEach((h, i) => { if (h && obj[h] === undefined) obj[h] = cells[i] ?? ''; });
    return obj;
  });
}

// Header + rows, each piece small enough for one serverless request. A single huge row is sent alone.
export function packCsvChunks(text, max = 800000) {
  const records = csvRecords(text);
  const header = records[0] ?? '';
  const body = records.slice(1).filter(r => r.trim());
  const chunks = [];
  let cur = [], size = header.length + 1;
  const flush = () => { if (cur.length) chunks.push({ csv: [header, ...cur].join('\n'), count: cur.length }); cur = []; size = header.length + 1; };
  for (const r of body) {
    const n = r.length + 1;
    if (cur.length && size + n > max) flush();
    cur.push(r);
    size += n;
  }
  flush();
  return chunks;
}
