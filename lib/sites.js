import { ebaySeller, ebayListings, ebayListing } from './ebay';
import { safeFetch } from './net';

// Website stores, Poshmark and eBay, read server-side (eBay through its official API, lib/ebay.js). Poshmark and Shopify: their own listing feeds. Others (Wix, …): product
// sitemap + the page's schema.org Product markup. Every fetch goes through safeFetch (public http(s) only).
const get = async url => {
  try {
    const got = await safeFetch(url);
    return { ok: true, text: async () => got.text, json: async () => JSON.parse(got.text) };
  } catch (e) { throw new Error(`${url}: ${e.message}`); }
};
const locs = xml => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
export const slug = url => new URL(url).pathname.split('/').filter(Boolean).pop();
const host = url => new URL(url).hostname.replace(/^www\./, '');
const text = html => (html ?? '').replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/\n\s*\n+/g, '\n').trim();

// Site address as typed → working URL (bare domains get https://, and www. if the bare host doesn't answer).
async function resolve(site) {
  const u = new URL(site.includes('://') ? site : `https://${site}`);
  try { await get(u.origin); } catch { if (!u.hostname.startsWith('www.')) u.hostname = `www.${u.hostname}`; }
  return u;
}

// Poshmark: a closet's feed carries every listing's full details, 48 per request — so a whole closet takes a handful of
// requests (gentle enough for daily syncs). A single listing can also be read by id.
const POSH = 'https://poshmark.com/vm-rest';
async function poshmarkCloset(user) {
  const items = [];
  for (let max = ''; ;) {
    const req = encodeURIComponent(JSON.stringify({ count: 48, ...(max && { max_id: max }) }));
    const j = await (await get(`${POSH}/users/${user}/posts?request=${req}&summarize=true`)).json();
    items.push(...j.data.map(poshmarkItem).filter(Boolean));
    if (!j.more?.is_next_max_id_present || !j.data.length) return items;
    max = j.more.next_max_id;
    await new Promise(r => setTimeout(r, 500));
  }
}
async function poshmarkListing(url) {
  const j = await (await get(`${POSH}/posts/${url.match(/([0-9a-f]{24})\/?$/)?.[1]}`)).json();
  return poshmarkItem(j.data ?? j); // a single listing isn't wrapped in { data }
}
function poshmarkItem(p) {
  if (p?.inventory?.status !== 'available') return null;
  const id = p.id, dept = p.department?.display;
  return {
    source: 'poshmark', source_id: id, source_url: `https://poshmark.com/listing/${id}`, title: p.title, price: p.price_amount?.val ?? null,
    description: p.description, brand: p.brand || null, size: p.size || null, color: p.colors?.[0]?.name ?? null,
    sized_for: /^(Women|Men|Kids)$/.test(dept) ? dept : null,
    condition: ['nwt', 'ret'].includes(p.condition) ? 'New' : 'Used', // NWT / boutique = new
    category: [p.category_v2?.display, dept, ...(p.style_tags ?? [])].filter(Boolean).join(' '),
    photos: [...new Set([p.cover_shot, ...(p.pictures ?? [])].filter(Boolean).map(x => x.url_large || x.url))],
  };
}

// A store's listings: { urls, items? }. items (by url) = details already read from a feed, so they needn't be fetched one by one.
export async function productList(site) {
  if (/facebook\.com|depop\.com/i.test(site)) throw new Error('Facebook and Depop links import through the BootLister Chrome extension — use Import on the inventory page with the extension installed.');
  const closet = site.match(/poshmark\.com\/closet\/([\w.-]+)/)?.[1], ebay = ebaySeller(site);
  if (!closet && !ebay) return { urls: await productUrls(site) };
  const items = closet ? await poshmarkCloset(closet) : await ebayListings(ebay);
  return { urls: items.map(i => i.source_url), items: Object.fromEntries(items.map(i => [i.source_url, i])) };
}

// All product page URLs: a Shopify collection link lists just that collection; otherwise every product in the sitemap.
async function productUrls(site) {
  const u = await resolve(site), coll = u.pathname.match(/\/collections\/[^/]+/)?.[0];
  if (coll) {
    const urls = [];
    for (let page = 1; ; page++) {
      const { products } = await (await get(`${u.origin}${coll}/products.json?limit=250&page=${page}`)).json();
      if (!products.length) return urls;
      urls.push(...products.map(p => `${u.origin}/products/${p.handle}`));
    }
  }
  const maps = locs(await (await get(`${u.origin}/sitemap.xml`)).text()).filter(m => /product/i.test(m));
  if (!maps.length) throw new Error('No product list found on this site.');
  const urls = (await Promise.all(maps.map(async m => locs(await (await get(m)).text())))).flat();
  return [...new Set(urls.filter(x => /\/product/.test(new URL(x).pathname)))];
}

// One product page → item fields (null if sold out).
export async function readProduct(url) {
  if (host(url) === 'poshmark.com') return poshmarkListing(url);
  if (host(url) === 'ebay.com') return ebayListing(url);
  const source = host(url), source_id = slug(url);
  if (/\/products\//.test(new URL(url).pathname)) { // Shopify
    const p = await (await get(`${url.split('?')[0]}.js`)).json();
    if (!p.available) return null;
    const vendorIsStore = p.vendor?.toLowerCase().replace(/[^a-z0-9]/g, '') === source.split('.')[0];
    return { source, source_id, source_url: url.split('?')[0], title: p.title, price: p.price / 100, description: text(p.description),
      brand: vendorIsStore ? null : p.vendor || null, photos: p.images.map(i => i.startsWith('//') ? `https:${i}` : i) };
  }
  const html = await (await get(url)).text();
  const p = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap(m => { try { const j = JSON.parse(m[1]); return j['@graph'] ?? [j].flat(); } catch { return []; } })
    .find(j => [j['@type']].flat().includes('Product'));
  if (!p) throw new Error('No product data on this page.');
  const offer = [p.offers].flat()[0] ?? {};
  if (/OutOfStock|SoldOut|Discontinued/i.test(offer.availability ?? '')) return null;
  return {
    source, source_id, source_url: url.split('?')[0], title: p.name, price: offer.price ?? offer.lowPrice ?? null, description: text(p.description),
    brand: p.brand?.name ?? (typeof p.brand === 'string' ? p.brand : null),
    // Full-size photos (Wix serves resized copies under /v1/…).
    photos: [p.image].flat().filter(Boolean).map(i => (i.contentUrl ?? i.url ?? i).replace(/(static\.wixstatic\.com\/media\/[^/]+)\/v1\/.*/, '$1')),
  };
}
