// Boots-only paging uses the shop page's own product list.
// Live shape, captured 2026-11-13 from a real Chrome on depop.com (shop products and aggregates):
//   products page: { objects: [{ id, slug, status: 'STATUS_ONSALE', ... }], page_info: { has_more, last } }
//   next page:     same URL plus &after=<page_info.last>; the last page has page_info.has_more === false and no last.
//   aggregates:    { total, categories, ... } where total is the count for the filters in the query string.
// Depop's page order shifts between requests (boosted listings), so one pass can repeat a listing and skip another.
// collectDepopPages therefore runs extra passes with other page sizes until the deduped count reaches the
// aggregates total, and reports a short read instead of passing it off as the whole list.
// Older field names (products, meta.cursor, meta.last_offset_id, meta.end, hasMore) are still accepted.
// The sold list is a different URL (/products/by-status/sold/) and is never requested.

export const DEPOP_PAGE_LIMIT = 24;
export const DEPOP_PAGE_PAUSE_MS = 400;
export const DEPOP_PASS_LIMITS = Object.freeze([24, 48, 96, 24]);
export const DEPOP_MAX_PAGES = 40;
export const DEPOP_API = 'https://webapi.depop.com/presentation/api/v1/shops/';

const SOLD = /by-status\/sold/i;
const SHOP_URL = /webapi\.depop\.com\/presentation\/api\/v1\/shops\/(\d{3,})\/(products|aggregates)\//;

function shopId(value) {
  const id = String(value || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('Depop shop id was not a number.');
  return id;
}

// Query params Depop itself sent on a shop products request (minus filters and paging), or {}.
export function templateParams(templateUrl) {
  const out = {};
  if (typeof templateUrl !== 'string' || !templateUrl || SOLD.test(templateUrl)) return out;
  let u;
  try { u = new URL(templateUrl); } catch { return out; }
  for (const [k, v] of u.searchParams) {
    if (['after', 'limit', 'groups', 'product_types', 'gender'].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export function depopProductsUrl(id, { gender = '', after = '', limit = DEPOP_PAGE_LIMIT, template = '' } = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(Number.isInteger(limit) && limit > 0 ? limit : DEPOP_PAGE_LIMIT));
  for (const [k, v] of Object.entries(templateParams(template))) q.set(k, v);
  q.set('groups', 'footwear');
  q.set('product_types', 'boots');
  if (gender) q.set('gender', gender);
  if (after) q.set('after', after);
  const url = `${DEPOP_API}${shopId(id)}/products/?${q}`;
  if (SOLD.test(url)) throw new Error('sold endpoint');
  return url;
}

export function depopAggregatesUrl(id, gender = '') {
  const q = new URLSearchParams();
  q.set('what', '');
  q.set('currency', 'USD');
  q.set('groups', 'footwear');
  q.set('product_types', 'boots');
  if (gender) q.set('gender', gender);
  const url = `${DEPOP_API}${shopId(id)}/aggregates/?${q}`;
  if (SOLD.test(url)) throw new Error('sold endpoint');
  return url;
}

const str = v => (typeof v === 'string' && v.trim() ? v.trim() : '');

// Tolerant reader for one products page. Field names are tried in order; the first live one wins.
export function parseProductsPage(body) {
  const b = body && typeof body === 'object' ? body : {};
  const list = [b.objects, b.products, b.data?.objects, b.data?.products, b.items].find(Array.isArray) || [];
  const info = [b.page_info, b.pageInfo, b.meta, b.data?.page_info].find(v => v && typeof v === 'object') || {};
  const cursor = str(info.last) || str(info.end_cursor) || str(info.endCursor) || str(info.cursor) || str(info.next_cursor)
    || str(info.nextCursor) || str(info.last_offset_id) || str(info.after) || str(b.next_cursor) || str(b.cursor) || '';
  const flags = [info.has_more, info.hasMore, info.has_next_page, info.hasNextPage, b.has_more, b.hasMore];
  const more = flags.find(v => typeof v === 'boolean');
  const ended = info.end === true || more === false;
  const products = list.filter(p => p && typeof p === 'object' && !/sold/i.test(String(p.status || '')));
  return { products, cursor, ended, hasMore: more === true, soldSkipped: list.length - products.length };
}

// Count for the query's filters. Never reads categories (those are the whole shop, not the filter).
export function aggregateTotal(body) {
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};
  const raw = [body?.total, body?.count, meta.totalCount, meta.total_count, meta.resultCount, meta.result_count]
    .find(v => v != null && v !== '');
  const n = Number(String(raw ?? '').replace(/[,.\s]/g, ''));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// Deduped count against the expected total. Short and over-full reads both fail.
export function judgeCount(found, expected) {
  const got = Number(found) || 0;
  const want = Number(expected) || 0;
  if (!want) return { ok: got > 0, verdict: got > 0 ? 'unchecked' : 'empty' };
  if (got === want) return { ok: true, verdict: 'match' };
  if (got < want) return { ok: false, verdict: 'short' };
  return { ok: false, verdict: got > want * 2 ? 'runaway' : 'over' };
}

// Pages every pass until the list ends; dedupes by product id across passes; stops on 403/429.
// Passes after the first use other page sizes so boundary shuffles land somewhere else.
export async function collectDepopPages({ shopId: id, gender = '', fetchJson, pause, cap = 400, expected = 0,
  template = '', passes = DEPOP_PASS_LIMITS, maxPages = DEPOP_MAX_PAGES }) {
  const seen = new Set();
  const urls = [];
  const ids = [];
  const requested = [];
  const log = [];
  let pages = 0;
  let stop = '';
  let finishedPass = false;
  const plan = expected ? passes : passes.slice(0, 1);
  for (const [n, limit] of plan.entries()) {
    if (expected && ids.length >= expected) break;
    if (n > 0 && pause) await pause();
    let after = '';
    let dry = 0;
    const visited = new Set();
    while (true) {
      if (pages >= maxPages) { stop = 'pages'; break; }
      const url = depopProductsUrl(id, { gender, after, limit, template });
      requested.push(url);
      const res = await fetchJson(url);
      const status = Number(res?.status) || 0;
      if (status !== 200) {
        log.push({ pass: n + 1, url, status, count: 0, added: 0, error: res?.error || '' });
        return { ok: false, status, urls: [], ids: [], pages, requested, log, stop: status ? String(status) : (res?.error ? 'fetch' : 'status') };
      }
      pages += 1;
      const page = parseProductsPage(res?.body);
      let added = 0;
      for (const product of page.products) {
        const slug = str(product.slug);
        if (!slug) continue;
        const key = product.id != null && product.id !== '' ? String(product.id) : `slug:${slug}`;
        if (seen.has(key) || seen.has(`slug:${slug}`)) continue;
        seen.add(key);
        seen.add(`slug:${slug}`);
        ids.push(key);
        urls.push(`https://www.depop.com/products/${slug}/`);
        added += 1;
        if (urls.length >= cap) break;
      }
      log.push({ pass: n + 1, url, status, count: page.products.length, added, hasMore: page.hasMore, ended: page.ended });
      if (urls.length >= cap) { stop = 'cap'; break; }
      if (!page.products.length) { stop = urls.length ? 'empty' : 'empty-first'; finishedPass = urls.length > 0; break; }
      dry = added ? 0 : dry + 1;
      if (page.ended || (!page.cursor && page.products.length < limit)) { stop = 'end'; finishedPass = true; break; }
      if (dry >= 2) { stop = 'no-new'; finishedPass = true; break; }
      // A full page with no next cursor is a failure on the first pass: the cursor field may be unnamed,
      // and stopping there would report the first page as the whole grid.
      if (!page.cursor || visited.has(page.cursor)) {
        if (n === 0 && !finishedPass) return { ok: false, status, urls: [], ids: [], pages, requested, log, stop: 'cursor' };
        stop = 'cursor';
        break;
      }
      visited.add(page.cursor);
      after = page.cursor;
      if (pause) await pause();
    }
    if (stop === 'cap' || stop === 'pages') break;
  }
  if (!urls.length) return { ok: false, status: 200, urls: [], ids: [], pages, requested, log, stop: stop || 'empty' };
  const judged = judgeCount(ids.length, expected);
  return { ok: true, status: 200, urls, ids, pages, requested, log, stop, expected, verdict: judged.verdict, complete: judged.ok };
}

// ---- shop id ----
// Every source the shop tab offered, in priority order. Returns { id, source, template, aggregates } or id ''.
export function shopIdFromUrls(list) {
  for (const raw of list || []) {
    const url = String(raw || '');
    if (SOLD.test(url)) continue;
    const m = url.match(SHOP_URL);
    if (m) return m[1];
  }
  return '';
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// The RSC payload (self.__next_f) and __NEXT_DATA__ text both carry the seller next to the username.
export function shopIdFromText(text, slug) {
  const t = String(text || '');
  if (!t) return '';
  const fromApi = shopIdFromUrls(t.match(new RegExp(SHOP_URL.source, 'g')) || []);
  if (fromApi) return fromApi;
  if (!slug) return '';
  const name = escapeRe(slug);
  const q = '\\\\?"';
  const near = [
    new RegExp(`${q}username${q}\\s*:\\s*${q}${name}${q}[^{}]{0,400}?${q}(?:id|user_?[iI]d)${q}\\s*:\\s*${q}?(\\d{3,})`, 'i'),
    new RegExp(`${q}(?:id|user_?[iI]d)${q}\\s*:\\s*${q}?(\\d{3,})${q}?[^{}]{0,400}?${q}username${q}\\s*:\\s*${q}${name}${q}`, 'i'),
  ];
  for (const re of near) { const m = t.match(re); if (m) return m[1]; }
  return '';
}

export function shopIdFromNextData(data, slug) {
  const want = String(slug || '').toLowerCase();
  const stack = [data];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { for (const item of node) stack.push(item); continue; }
    const username = String(node.username || node.slug || '').toLowerCase();
    const id = node.id ?? node.userId ?? node.user_id;
    if (want && username === want && /^\d{3,}$/.test(String(id))) return String(id);
    for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
  }
  return '';
}

export function pickShopId(sources = {}, slug = '', cached = '') {
  const hookUrls = (sources.hookUrls || []).filter(u => !SOLD.test(String(u)));
  const template = hookUrls.find(u => /\/products\/\?/.test(u)) || (sources.resourceUrls || []).find(u => SHOP_URL.test(u) && !SOLD.test(u) && /\/products\/\?/.test(u)) || '';
  const tries = [
    ['resource', () => shopIdFromUrls(sources.resourceUrls)],
    ['fetch-hook', () => shopIdFromUrls(hookUrls)],
    ['rsc', () => shopIdFromText(sources.nextF, slug)],
    ['next-data', () => {
      let data = sources.nextData;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
      return shopIdFromNextData(data, slug);
    }],
    ['cache', () => (/^\d{3,}$/.test(String(cached || '')) ? String(cached) : '')],
  ];
  for (const [source, read] of tries) {
    const id = read();
    if (id) return { id, source, template: template && template.includes(`/shops/${id}/`) ? template : '' };
  }
  return { id: '', source: '', template: '' };
}

// Product URLs from responses the page fetched itself (captured by depop-hook.js), for one filter.
export function hookPageUrls(pages, gender = '') {
  const urls = [];
  const seen = new Set();
  for (const page of pages || []) {
    const url = String(page?.url || '');
    if (SOLD.test(url) || !/\/products\/\?/.test(url)) continue;
    let q;
    try { q = new URL(url).searchParams; } catch { continue; }
    if (q.get('product_types') !== 'boots' || (q.get('gender') || '') !== gender) continue;
    for (const item of page.items || []) {
      const slug = str(item?.slug);
      if (!slug || /sold/i.test(String(item?.status || ''))) continue;
      const key = item.id != null ? String(item.id) : `slug:${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(`https://www.depop.com/products/${slug}/`);
    }
  }
  return urls;
}

// Visible-tab DOM fallback. Known oracle: exact match only. Unknown oracle: a cap hit or >150 links is a failure.
export const DOM_UNKNOWN_MAX = 150;
export function judgeDomRead({ urls = [], expected = 0, capHit = false }) {
  if (capHit) return { ok: false, reason: `hit the scan cap (${urls.length} links)` };
  if (!expected && urls.length > DOM_UNKNOWN_MAX) return { ok: false, reason: `${urls.length} links with no expected count (over ${DOM_UNKNOWN_MAX})` };
  const j = judgeCount(urls.length, expected);
  if (j.ok) return { ok: true, reason: '' };
  if (j.verdict === 'empty') return { ok: false, reason: 'no links' };
  return { ok: false, reason: `${urls.length}/${expected} ${j.verdict}` };
}

// Does a captured webapi URL belong to this shop and boots filter (gender '' = all boots)?
export function hookUrlMatches(url, gender = '', id = '', kind = 'products') {
  const u = String(url || '');
  if (SOLD.test(u)) return false;
  const m = u.match(SHOP_URL);
  if (!m || m[2] !== kind || (id && m[1] !== String(id))) return false;
  let q;
  try { q = new URL(u).searchParams; } catch { return false; }
  return q.get('product_types') === 'boots' && (q.get('groups') || 'footwear') === 'footwear' && (q.get('gender') || '') === String(gender || '');
}

const totalOf = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

// Depop's own responses for one filter (captured by depop-hook.js) -> unique on-sale ids/slugs, the has_more trail,
// and an oracle from the aggregates total (or a product-response total). complete only when the trail ended and
// the oracle, when known, matches exactly.
export function collectHookProducts(hook, gender = '', id = '') {
  const seen = new Set();
  const ids = [];
  const urls = [];
  const hasMoreTrail = [];
  let skipped = 0;
  let pages = 0;
  let pageTotal = 0;
  for (const page of hook?.pages || []) {
    if (!hookUrlMatches(page?.url, gender, id) || Number(page?.status) !== 200) continue;
    pages += 1;
    const more = page?.page_info?.has_more ?? page?.page_info?.hasMore;
    hasMoreTrail.push(typeof more === 'boolean' ? more : null);
    pageTotal = totalOf(page?.total) || pageTotal;
    for (const item of page.items || []) {
      const slug = str(item?.slug);
      const status = String(item?.status || '');
      if (!slug || status !== 'STATUS_ONSALE') { skipped += 1; continue; }
      if (id && item?.user_id != null && String(item.user_id) !== String(id)) { skipped += 1; continue; }
      const key = item.id != null && item.id !== '' ? String(item.id) : `slug:${slug}`;
      if (seen.has(key) || seen.has(`slug:${slug}`)) continue;
      seen.add(key);
      seen.add(`slug:${slug}`);
      ids.push(key);
      urls.push(`https://www.depop.com/products/${slug}/`);
    }
  }
  let aggregateTotalSeen = 0;
  for (const a of hook?.aggregates || []) {
    if (Number(a?.status) === 200 && hookUrlMatches(a?.url, gender, id, 'aggregates')) aggregateTotalSeen = totalOf(a?.total) || aggregateTotalSeen;
  }
  const expected = aggregateTotalSeen || pageTotal;
  const ended = hasMoreTrail.includes(false);
  const judged = judgeCount(ids.length, expected);
  return { ids, urls, expected, expectedSource: aggregateTotalSeen ? 'aggregates' : pageTotal ? 'response' : '', pages, hasMoreTrail, ended,
    skipped, verdict: ended ? judged.verdict : 'open', complete: ended && judged.ok };
}

// Merge another round's ids (e.g. after a reload) without duplicates; order of first sighting is kept.
export function mergeHookRounds(a, b) {
  const ids = [...(a?.ids || [])];
  const urls = [...(a?.urls || [])];
  const seen = new Set(ids);
  (b?.ids || []).forEach((key, i) => { if (!seen.has(key)) { seen.add(key); ids.push(key); urls.push(b.urls[i]); } });
  const expected = b?.expected || a?.expected || 0;
  const ended = !!(a?.ended || b?.ended);
  const judged = judgeCount(ids.length, expected);
  return { ...b, ids, urls, expected, ended, hasMoreTrail: [...(a?.hasMoreTrail || []), ...(b?.hasMoreTrail || [])],
    verdict: ended ? judged.verdict : 'open', complete: ended && judged.ok };
}

// The page's own first product-list request, used to replay Depop's exact init once before falling back.
export function replayRequest(hook, id = '') {
  for (const r of hook?.requests || []) {
    const url = String(r?.url || '');
    const m = url.match(SHOP_URL);
    if (!m || m[2] !== 'products' || SOLD.test(url) || (id && m[1] !== String(id))) continue;
    const init = r?.init && typeof r.init === 'object' ? r.init : {};
    if (init.method && init.method !== 'GET') continue;
    return { url, init };
  }
  return null;
}

// Product pages are only opened for listings in the collected boots list, one at a time, with a pause.
export const PRODUCT_PAGE_PAUSE_MS = 1500;
export function productPlan(urls, max = 200) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const slug = String(raw || '').match(/^https:\/\/www\.depop\.com\/products\/([^/]+)\/?$/)?.[1];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(`https://www.depop.com/products/${slug}/`);
    if (out.length >= max) break;
  }
  return out;
}

// One JSON file Dan can send back after a live run.
export function debugDump({ version = '', shop = '', shopId: id = '', source = '', sources = {}, variants = [], fallback = null, replay = null, hookRuns = [], productReads = [], at = '' } = {}) {
  return {
    kind: 'bootlister-depop-debug',
    version, shop, at,
    shopId: id, shopIdSource: source,
    capturedUrls: {
      resource: (sources.resourceUrls || []).slice(0, 60),
      fetchHook: (sources.hookUrls || []).slice(0, 60),
      nextFLength: String(sources.nextF || '').length,
      nextData: !!sources.nextData,
    },
    variants: variants.map(v => ({
      label: v.label, gender: v.gender, expected: v.expected || 0, found: (v.ids || v.urls || []).length,
      verdict: v.verdict || '', stop: v.stop || '', pages: v.pages || 0,
      perPage: (v.log || []).map(p => ({ pass: p.pass, url: p.url, status: p.status, count: p.count, added: p.added, error: p.error || undefined })),
      ids: v.ids || [], urls: v.urls || [],
    })),
    replay,
    hookRuns: hookRuns.map(r => ({ label: r.label, gender: r.gender, expected: r.expected || 0, expectedSource: r.expectedSource || '',
      found: (r.ids || []).length, complete: !!r.complete, verdict: r.verdict || '', pages: r.pages || 0, rounds: r.rounds || 0,
      scrolls: r.scrolls || 0, stop: r.stop || '', hasMoreTrail: r.hasMoreTrail || [], growth: r.growth || [], hookErrors: r.hookErrors || [], ids: r.ids || [] })),
    productReads: productReads.slice(0, 200),
    fallback,
  };
}
