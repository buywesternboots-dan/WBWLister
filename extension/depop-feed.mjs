// Boots-only paging uses the shop page's own product list. The next-cursor field names were not
// confirmed on a live 200 from this environment (Cloudflare returned 403). The reader accepts the
// names from that request and from public shop/search payloads that use the same cursor:
// products[].id, products[].slug, meta.cursor, meta.last_offset_id, meta.end, meta.hasMore, meta.has_more.
// A total, when present, is read from total, count, meta.totalCount, meta.total_count,
// meta.resultCount, or meta.result_count. The sold list is a different URL and is never requested.

export const DEPOP_PAGE_LIMIT = 24;
export const DEPOP_PAGE_PAUSE_MS = 400;

function shopId(value) {
  const id = String(value || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('Depop shop id was not a number.');
  return id;
}

export function depopProductsUrl(id, { gender = '', after = '' } = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(DEPOP_PAGE_LIMIT));
  q.set('groups', 'footwear');
  q.set('product_types', 'boots');
  if (gender) q.set('gender', gender);
  if (after) q.set('after', after);
  const url = `https://webapi.depop.com/presentation/api/v1/shops/${shopId(id)}/products/?${q}`;
  if (/by-status\/sold/i.test(url)) throw new Error('sold endpoint');
  return url;
}

export function depopAggregatesUrl(id, gender = '') {
  const q = new URLSearchParams();
  q.set('groups', 'footwear');
  q.set('product_types', 'boots');
  if (gender) q.set('gender', gender);
  const url = `https://webapi.depop.com/presentation/api/v1/shops/${shopId(id)}/aggregates/?${q}`;
  if (/by-status\/sold/i.test(url)) throw new Error('sold endpoint');
  return url;
}

export function parseProductsPage(body) {
  const products = Array.isArray(body?.products) ? body.products : [];
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};
  const cursor = typeof meta.cursor === 'string' ? meta.cursor
    : typeof meta.last_offset_id === 'string' ? meta.last_offset_id
    : '';
  const ended = meta.end === true || meta.hasMore === false || meta.has_more === false;
  return { products, cursor, ended };
}

export function aggregateTotal(body) {
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};
  const raw = [body?.total, body?.count, meta.totalCount, meta.total_count, meta.resultCount, meta.result_count]
    .find(v => v != null && v !== '');
  const n = Number(String(raw ?? '').replace(/[,.\s]/g, ''));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// Pages until the list ends. A full page with no next cursor is a failure: the cursor field may
// be unnamed, and stopping there would report the first 24 as the whole grid.
export async function collectDepopPages({ shopId: id, gender = '', fetchJson, pause, cap = 400 }) {
  const seen = new Set();
  const urls = [];
  const requested = [];
  let after = '';
  let pages = 0;
  let stop = '';
  while (urls.length < cap) {
    const url = depopProductsUrl(id, { gender, after });
    requested.push(url);
    const res = await fetchJson(url);
    const status = Number(res?.status) || 0;
    if (status !== 200) return { ok: false, status, urls: [], pages, requested, stop: status ? String(status) : 'status' };
    pages += 1;
    const { products, cursor, ended } = parseProductsPage(res?.body);
    if (!products.length) {
      if (!urls.length) return { ok: false, status, urls: [], pages, requested, stop: 'empty' };
      stop = 'empty';
      break;
    }
    for (const product of products) {
      const slug = typeof product?.slug === 'string' ? product.slug.trim() : '';
      if (!slug) continue;
      const key = product?.id != null && product.id !== '' ? String(product.id) : slug;
      if (seen.has(key) || seen.has(slug)) continue;
      seen.add(key);
      seen.add(slug);
      urls.push(`https://www.depop.com/products/${slug}/`);
      if (urls.length >= cap) { stop = 'cap'; break; }
    }
    if (stop === 'cap') break;
    if (ended || products.length < DEPOP_PAGE_LIMIT) { stop = 'end'; break; }
    if (!cursor || cursor === after) return { ok: false, status, urls: [], pages, requested, stop: 'cursor' };
    after = cursor;
    if (pause) await pause();
  }
  return { ok: true, status: 200, urls, pages, requested, stop };
}
