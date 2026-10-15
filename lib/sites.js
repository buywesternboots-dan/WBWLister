// Website stores. Shopify: its product feeds. Others (Wix, …): product sitemap + the page's schema.org Product markup.
const get = async url => {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
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

// All product page URLs: a Shopify collection link lists just that collection; otherwise every product in the sitemap.
export async function productUrls(site) {
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
  const source = host(url), source_id = slug(url);
  if (/\/products\//.test(new URL(url).pathname)) { // Shopify
    const p = await (await get(`${url.split('?')[0]}.js`)).json();
    if (!p.available) return null;
    const vendorIsStore = p.vendor?.toLowerCase().replace(/[^a-z0-9]/g, '') === source.split('.')[0];
    return { source, source_id, title: p.title, price: p.price / 100, description: text(p.description),
      brand: vendorIsStore ? null : p.vendor || null, photos: p.images.map(i => i.startsWith('//') ? `https:${i}` : i).slice(0, 30) };
  }
  const html = await (await get(url)).text();
  const p = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap(m => { try { const j = JSON.parse(m[1]); return j['@graph'] ?? [j].flat(); } catch { return []; } })
    .find(j => [j['@type']].flat().includes('Product'));
  if (!p) throw new Error('No product data on this page.');
  const offer = [p.offers].flat()[0] ?? {};
  if (/OutOfStock|SoldOut|Discontinued/i.test(offer.availability ?? '')) return null;
  return {
    source, source_id, title: p.name, price: offer.price ?? offer.lowPrice ?? null, description: text(p.description),
    brand: p.brand?.name ?? (typeof p.brand === 'string' ? p.brand : null),
    // Full-size photos (Wix serves resized copies under /v1/…).
    photos: [p.image].flat().filter(Boolean).map(i => (i.contentUrl ?? i.url ?? i).replace(/(static\.wixstatic\.com\/media\/[^/]+)\/v1\/.*/, '$1')).slice(0, 30),
  };
}
