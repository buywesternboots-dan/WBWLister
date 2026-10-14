// Website stores (Wix, Shopify, …): product list from the sitemap, product data from the page's schema.org Product markup.
const get = async url => {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};
const locs = xml => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
export const slug = url => new URL(url).pathname.split('/').filter(Boolean).pop();

// All product page URLs of a store: product sitemaps linked from /sitemap.xml.
export async function productUrls(site) {
  const base = new URL(site.includes('://') ? site : `https://${site}`).origin;
  const maps = locs(await get(`${base}/sitemap.xml`)).filter(u => /product/i.test(u));
  if (!maps.length) throw new Error('No product sitemap found on this site.');
  return [...new Set((await Promise.all(maps.map(async m => locs(await get(m))))).flat())];
}

// One product page → item fields (null if it isn't for sale).
export async function readProduct(url) {
  const html = await get(url);
  const p = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap(m => { try { const j = JSON.parse(m[1]); return j['@graph'] ?? [j].flat(); } catch { return []; } })
    .find(j => j['@type'] === 'Product');
  if (!p) throw new Error('No product data on this page.');
  const offer = [p.offers].flat()[0] ?? {};
  if (/OutOfStock|SoldOut|Discontinued/i.test(offer.availability ?? '')) return null;
  return {
    source: new URL(url).hostname.replace(/^www\./, ''),
    source_id: slug(url),
    title: p.name,
    price: offer.price ?? offer.lowPrice ?? null,
    description: p.description ?? '',
    brand: p.brand?.name ?? (typeof p.brand === 'string' ? p.brand : null),
    // Full-size photos (Wix serves resized copies under /v1/…).
    photos: [p.image].flat().filter(Boolean).map(i => (i.contentUrl ?? i.url ?? i).replace(/(static\.wixstatic\.com\/media\/[^/]+)\/v1\/.*/, '$1')).slice(0, 20),
  };
}
