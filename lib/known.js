// Which candidate links are already stored. Matching is exact on the listing id or the source URL.

export const KNOWN_CAP = 400;
export const REJECT_WRITE_CAP = 100;
const STORE_REASONS = new Set(['non-footwear', 'other-footwear', 'boot-modifier']);

// Uncertain, unread, and any other kind are dropped. Nothing here creates a listing.
export function acceptRejectRows(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const reason = String(row?.reason || '');
    if (!STORE_REASONS.has(reason)) continue;
    const source_id = String(row?.source_id || candidateId(row?.source_url) || '').trim();
    if (!source_id || source_id.length > 200 || seen.has(source_id)) continue;
    seen.add(source_id);
    out.push({ source_id, source_url: String(row?.source_url || '').trim().slice(0, 300), reason });
  }
  return out;
}

export function visibleRejects(rows, gateVersion) {
  const version = Number(gateVersion);
  return (rows || []).filter(r => Number(r?.gate_version) === version);
}

export function candidateId(url) {
  const s = String(url || '');
  const dep = s.match(/depop\.com\/products\/([^/?#]+)\/?$/i);
  if (dep) return decodeURIComponent(dep[1]);
  const fb = s.match(/facebook\.com\/marketplace\/item\/(\d+)/i);
  if (fb) return fb[1];
  return '';
}

export function normalizeUrl(url) {
  try {
    const u = new URL(String(url));
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}`;
  } catch { return ''; }
}

// rows are already limited to one seller and one source. A candidate matches its id or its URL.
export function matchKnown(rows, candidates) {
  const byId = new Map();
  const byUrl = new Map();
  for (const row of rows || []) {
    const id = String(row?.source_id || '');
    if (id) byId.set(id, row);
    const url = normalizeUrl(row?.source_url || '');
    if (url) byUrl.set(url, row);
    const fromUrl = candidateId(row?.source_url || '');
    if (fromUrl && !byId.has(fromUrl)) byId.set(fromUrl, row);
  }
  const known = [];
  const seen = new Set();
  for (const c of candidates || []) {
    const id = String(c?.id || candidateId(c?.url) || '').trim();
    const url = normalizeUrl(c?.url || '');
    const row = (id && byId.get(id)) || (url && byUrl.get(url));
    if (!row) continue;
    const source_id = String(row.source_id || id);
    if (!source_id || seen.has(source_id)) continue;
    seen.add(source_id);
    known.push({ id: id || candidateId(row.source_url || ''), url: c?.url || row.source_url || '', source_id });
  }
  return { known };
}
